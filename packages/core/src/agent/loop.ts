import type Database from "better-sqlite3";
import type { LLMMessage } from "../provider/types.js";
import { initDatabase } from "../session/database.js";
import { SessionStore } from "../session/session-store.js";
import { SqliteHistory } from "../session/sqlite-history.js";
import type { InboundMessage, SessionKey } from "../types.js";
import { ContextBuilder } from "./context-builder.js";
import type { ContextBuilderResult, SessionContext } from "./context-builder.js";
import { InMemoryHistory } from "./history.js";
import { ConversationSummarizer } from "./summarizer.js";
import { buildToolMap } from "./tool-bridge.js";
import type { AgentLoopOptions, AgentLoopResult, ConversationHistory, StepEvent } from "./types.js";

const DEFAULT_SYSTEM_PROMPT = "You are FeatherBot, a helpful AI assistant.";

export class AgentLoop {
	private readonly options: AgentLoopOptions;
	private readonly sessions = new Map<SessionKey, ConversationHistory>();
	private readonly firstConversationCleared = new Set<SessionKey>();
	private readonly systemPrompt: string;
	private readonly contextBuilder?: ContextBuilder;
	private readonly db?: Database.Database;
	private readonly sessionStore?: SessionStore;
	private readonly maxMessages: number;
	private readonly summarizer?: ConversationSummarizer;

	constructor(options: AgentLoopOptions) {
		this.options = options;
		this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
		this.maxMessages = options.sessionConfig?.maxMessages ?? 50;
		const dbPath = options.sessionConfig?.dbPath ?? "";
		if (dbPath !== "") {
			this.db = initDatabase(dbPath);
			this.sessionStore = new SessionStore(this.db);
		}
		if (options.workspacePath !== undefined) {
			this.contextBuilder = new ContextBuilder({
				workspacePath: options.workspacePath,
				bootstrapFiles: options.config.bootstrapFiles,
				agentName: "FeatherBot",
				memoryStore: options.memoryStore,
				skillsLoader: options.skillsLoader,
				registeredToolNames: options.toolRegistry.getRegisteredNames(),
			});
		}
		const summarizationEnabled = options.sessionConfig?.summarizationEnabled ?? true;
		if (summarizationEnabled) {
			this.summarizer = new ConversationSummarizer({
				provider: options.provider,
				model: options.config.model,
			});
		}
	}

	close(): void {
		if (this.db) {
			this.db.close();
		}
	}

	getHistory(sessionKey: SessionKey): LLMMessage[] {
		const history = this.sessions.get(sessionKey);
		return history ? history.getMessages() : [];
	}

	injectMessage(sessionKey: SessionKey, message: LLMMessage): void {
		const history = this.getOrCreateHistory(sessionKey);
		history.add(message);
	}

	async processMessage(inbound: InboundMessage): Promise<AgentLoopResult> {
		const sessionKey: SessionKey = `${inbound.channel}:${inbound.chatId}`;
		const sessionContext: SessionContext = {
			channelName: inbound.channel,
			chatId: inbound.chatId,
		};
		const ctx = await this.resolveContext(this.systemPrompt, sessionContext);
		return this.run(sessionKey, inbound.content, ctx);
	}

	async processDirect(
		message: string,
		options?: {
			systemPrompt?: string;
			sessionKey?: string;
			skipHistory?: boolean;
			maxSteps?: number;
			signal?: AbortSignal;
		},
	): Promise<AgentLoopResult> {
		const sessionKey: SessionKey = (options?.sessionKey as SessionKey) ?? "direct:default";
		const staticPrompt = options?.systemPrompt ?? this.systemPrompt;
		const builtCtx = await this.resolveContext(staticPrompt);
		const ctx =
			options?.systemPrompt !== undefined && this.contextBuilder !== undefined
				? { ...builtCtx, systemPrompt: `${options.systemPrompt}\n\n${builtCtx.systemPrompt}` }
				: builtCtx;
		return this.run(
			sessionKey,
			message,
			ctx,
			options?.skipHistory,
			options?.maxSteps,
			options?.signal,
		);
	}

	private getOrCreateHistory(sessionKey: SessionKey): ConversationHistory {
		let history = this.sessions.get(sessionKey);
		if (history === undefined) {
			if (this.db !== undefined && this.sessionStore !== undefined) {
				this.sessionStore.getOrCreate(sessionKey);
				const sqliteHistory = new SqliteHistory(this.db, sessionKey, {
					maxMessages: this.maxMessages,
				});
				if (this.summarizer) {
					sqliteHistory.setSummarizer(this.summarizer);
				}
				history = sqliteHistory;
			} else {
				const memHistory = new InMemoryHistory({ maxMessages: this.maxMessages });
				if (this.summarizer) {
					memHistory.setSummarizer(this.summarizer);
				}
				history = memHistory;
			}
			this.sessions.set(sessionKey, history);
		}
		return history;
	}

	private async resolveContext(
		fallback: string,
		sessionContext?: SessionContext,
	): Promise<ContextBuilderResult> {
		if (this.contextBuilder === undefined) {
			return { systemPrompt: fallback, isFirstConversation: false };
		}
		return this.contextBuilder.build(sessionContext);
	}

	private async run(
		sessionKey: SessionKey,
		userContent: string,
		ctx: ContextBuilderResult,
		skipHistory?: boolean,
		maxStepsOverride?: number,
		signal?: AbortSignal,
	): Promise<AgentLoopResult> {
		const history = this.getOrCreateHistory(sessionKey);

		if (ctx.isFirstConversation && !this.firstConversationCleared.has(sessionKey)) {
			history.clear();
			this.firstConversationCleared.add(sessionKey);
		}

		const { provider, toolRegistry, config } = this.options;

		const toolMap = buildToolMap(toolRegistry);

		const historyMessages = sanitizeHistory(history.getMessages());

		const messages: LLMMessage[] = [
			{ role: "system", content: ctx.systemPrompt },
			...historyMessages,
			{ role: "user", content: userContent },
		];

		const effectiveMaxSteps = maxStepsOverride ?? config.maxToolIterations;
		const result = await provider.generate({
			model: config.model,
			messages,
			tools: effectiveMaxSteps > 1 && Object.keys(toolMap).length > 0 ? toolMap : undefined,
			maxSteps: effectiveMaxSteps,
			temperature: config.temperature,
			maxTokens: config.maxTokens,
			signal,
		});

		const steps = result.toolCalls.length > 0 ? result.toolCalls.length + 1 : 1;

		if (!skipHistory) {
			history.add({ role: "user", content: userContent });
			if (result.text) {
				history.add({ role: "assistant", content: result.text });
			}

			if (this.sessionStore !== undefined) {
				this.sessionStore.touch(sessionKey);
			}
		}

		this.invokeStepCallback({
			stepNumber: steps,
			text: result.text,
			toolCalls: result.toolCalls,
			toolResults: result.toolResults,
			usage: result.usage,
		});

		return {
			text: result.text,
			usage: result.usage,
			steps,
			finishReason: result.finishReason,
			toolCalls: result.toolCalls,
			toolResults: result.toolResults,
		};
	}

	private invokeStepCallback(event: StepEvent): void {
		const callback = this.options.onStepFinish;
		if (callback === undefined) {
			return;
		}
		try {
			callback(event);
		} catch {
			// Callback errors are silently caught — they must not crash the loop
		}
	}
}

/**
 * Sanitize conversation history before sending to the LLM.
 *
 * Handles two edge cases:
 * 1. Orphaned tool-result messages (role: "tool" with toolCallId) that appear
 *    without a preceding assistant tool-call — these confuse the LLM.
 * 2. The last message being a dangling assistant message with a toolCallId
 *    but no following tool result (process crash mid-execution).
 *
 * In the current architecture, tool calls/results are handled within a single
 * provider.generate() call and only user/assistant messages are persisted.
 * This function is a defensive guard against DB corruption, future changes,
 * or external session modifications.
 */
export function sanitizeHistory(messages: LLMMessage[]): LLMMessage[] {
	if (messages.length === 0) return messages;

	const result: LLMMessage[] = [];
	const seenToolCallIds = new Set<string>();

	// First pass: collect all toolCallIds from messages that might be "callers"
	// (assistant messages with toolCallId indicate a tool was invoked)
	for (const msg of messages) {
		if (msg.role === "assistant" && msg.toolCallId) {
			seenToolCallIds.add(msg.toolCallId);
		}
	}

	let needsInjection = false;
	let lastAssistantToolCallId: string | undefined;

	for (const msg of messages) {
		// Skip orphaned tool results that don't match any known tool call
		if (msg.role === "tool" && msg.toolCallId && !seenToolCallIds.has(msg.toolCallId)) {
			continue;
		}

		result.push(msg);

		if (msg.role === "assistant" && msg.toolCallId) {
			lastAssistantToolCallId = msg.toolCallId;
			needsInjection = true;
		} else if (msg.role === "tool" && msg.toolCallId === lastAssistantToolCallId) {
			needsInjection = false;
			lastAssistantToolCallId = undefined;
		}
	}

	// If the last assistant message had a tool call with no result, inject one
	if (needsInjection && lastAssistantToolCallId) {
		result.push({
			role: "tool",
			content: "[Tool call was interrupted — process restarted before completion]",
			toolCallId: lastAssistantToolCallId,
		});
	}

	return result;
}
