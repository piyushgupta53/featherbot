import type Database from "better-sqlite3";
import type { LLMMessage } from "../provider/types.js";
import { initDatabase } from "../session/database.js";
import { SessionStore } from "../session/session-store.js";
import { SqliteHistory } from "../session/sqlite-history.js";
import type { InboundMessage, LLMToolCall, SessionKey, ToolResult } from "../types.js";
import { ContextBuilder } from "./context-builder.js";
import type { ContextBuilderResult, SessionContext } from "./context-builder.js";
import { ChainOfVerification } from "./cove.js";
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
	private readonly cove?: ChainOfVerification;

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
		const coveEnabled = options.config.coveEnabled ?? true;
		if (coveEnabled) {
			this.cove = new ChainOfVerification({
				provider: options.provider,
				toolRegistry: options.toolRegistry,
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
		const timeoutMs = this.options.config.messageTimeoutMs;
		if (timeoutMs !== undefined) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				return await this.run(
					sessionKey,
					inbound.content,
					ctx,
					undefined,
					undefined,
					controller.signal,
				);
			} catch (err) {
				if (controller.signal.aborted) {
					return {
						text: "Sorry, that request took too long. Please try again or simplify your question.",
						usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
						steps: 0,
						finishReason: "error",
						toolCalls: [],
						toolResults: [],
					};
				}
				throw err;
			} finally {
				clearTimeout(timer);
			}
		}
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

		let responseText = result.text;
		if (this.cove && result.text && result.finishReason !== "error") {
			const hasUnverified = ChainOfVerification.hasUnverifiedClaims(result.text, result.toolCalls);
			if (hasUnverified) {
				try {
					const coveResult = await this.cove.verify(
						result.text,
						result.toolCalls,
						result.toolResults,
					);
					if (coveResult.hasHallucination) {
						responseText = coveResult.verifiedResponse;
					}
				} catch {
					// CoVE failed — use original response. Unverified > no response.
				}
			}
		}

		const steps = result.toolCalls.length > 0 ? result.toolCalls.length + 1 : 1;

		if (!skipHistory) {
			history.add({ role: "user", content: userContent });
			const finalText = ensureTextResponse(responseText, result.toolCalls, result.toolResults);
			if (finalText && !finalText.startsWith("[LLM Error]")) {
				// Store only the clean text response, never tool logs
				// Tool calls/results are handled by the AI SDK internally
				history.add({ role: "assistant", content: finalText });
			}

			if (this.sessionStore !== undefined) {
				this.sessionStore.touch(sessionKey);
			}
		}

		this.invokeStepCallback({
			stepNumber: steps,
			text: responseText,
			toolCalls: result.toolCalls,
			toolResults: result.toolResults,
			usage: result.usage,
		});

		const userText = buildSafeUserText(responseText, result.toolCalls, result.toolResults);

		return {
			text: userText,
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

const TOOL_LOG_ARGS_MAX = 150;
const TOOL_LOG_RESULT_MAX = 500;
const EVICTED_MARKER = "[Result too large";

/**
 * Build a compact tool activity log to append to the assistant message
 * persisted in history. This lets the LLM reference what tools were called
 * and their results in subsequent turns.
 *
 * For results that were evicted to filesystem by the result-evictor (large
 * tool outputs), the log only includes the file pointer — not the head/tail
 * preview — so the agent can use read_file to recover the full data.
 */
export function buildToolLog(toolCalls: LLMToolCall[], toolResults: ToolResult[]): string {
	const resultMap = new Map<string, string>();
	for (const tr of toolResults) {
		resultMap.set(tr.toolCallId, tr.content);
	}

	const entries: string[] = [];
	for (const tc of toolCalls) {
		const args = JSON.stringify(tc.arguments);
		const compactArgs =
			args.length > TOOL_LOG_ARGS_MAX ? `${args.slice(0, TOOL_LOG_ARGS_MAX)}…` : args;

		const rawResult = resultMap.get(tc.id) ?? "(no result)";
		const resultText = compactResultForLog(rawResult);

		entries.push(`${tc.name}(${compactArgs}) → ${resultText}`);
	}

	return `[Tool activity: ${entries.join(" | ")}]`;
}

/**
 * Compact a tool result for the history log.
 * - Evicted results: extract just the file pointer line
 * - Small results (≤ TOOL_LOG_RESULT_MAX): keep as-is
 * - Medium results: truncate with ellipsis
 */
function compactResultForLog(result: string): string {
	// Evicted result — extract the file path pointer, drop the head/tail preview
	if (result.startsWith(EVICTED_MARKER)) {
		const pointerMatch = result.match(
			/\[Full content: (scratch\/\.tool-results\/.+?) — use read_file to access\]/,
		);
		if (pointerMatch?.[1]) {
			return `[Large result saved to ${pointerMatch[1]}]`;
		}
		// Fallback: extract just the first line (the size summary)
		const firstLine = result.split("\n")[0] ?? result;
		return firstLine;
	}

	if (result.length <= TOOL_LOG_RESULT_MAX) {
		return result;
	}

	return `${result.slice(0, TOOL_LOG_RESULT_MAX)}…`;
}

/**
 * Strip any tool activity artifacts the LLM may have echoed back
 * in its response text — both legacy XML format and new bracket format.
 */
export function stripToolLog(text: string): string {
	return text
		.replace(/<tool_log>[\s\S]*?<\/tool_log>/g, "")
		.replace(/<tool_log>[\s\S]*?<\/minimax:tool_call>/g, "")
		.replace(/<tool_log>[\s\S]*$/g, "")
		.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
		.replace(/\[\[Tool[^\]]*\]\]/g, "")
		.replace(/\[Tool activity:[\s\S]*?\](?=\s|$)/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Ensure we always return a text response to the user.
 * If text is empty but tool calls/results exist, generate a fallback.
 */
export function ensureTextResponse(
	text: string | undefined,
	toolCalls: LLMToolCall[],
	toolResults: ToolResult[],
): string | undefined {
	const textContent = text?.trim() ?? "";
	if (textContent.length > 0) {
		return text;
	}

	if (toolCalls.length > 0) {
		if (toolResults.length > 0) {
			const parts: string[] = [];
			for (const tc of toolCalls) {
				const result = toolResults.find((r) => r.toolCallId === tc.id);
				if (result) {
					const preview =
						result.content.length > 100 ? `${result.content.slice(0, 100)}...` : result.content;
					parts.push(`${tc.name}: ${preview}`);
				} else {
					parts.push(`${tc.name}: (no result)`);
				}
			}
			return `Executed: ${parts.join(" | ")}`;
		}
		return `Executed ${toolCalls.length} tool(s): ${toolCalls.map((t) => t.name).join(", ")}`;
	}

	return textContent || "";
}

/**
 * Build a user-safe final text response.
 *
 * Guarantees non-empty output even if tool-log stripping removes the entire
 * model response. Never returns raw tool activity or technical content.
 */
export function buildSafeUserText(
	text: string | undefined,
	toolCalls: LLMToolCall[],
	toolResults: ToolResult[],
): string {
	const primary = ensureTextResponse(text, toolCalls, toolResults) ?? "";
	const stripped = stripToolLog(primary);

	// If stripping left us with content, use it
	if (stripped.trim().length > 0) {
		return stripped;
	}

	// If primary was just tool activity (now stripped away), generate a proper fallback
	// NEVER return the raw tool activity text
	const toolFallback = ensureTextResponse("", toolCalls, toolResults) ?? "";
	if (toolFallback.trim().length > 0) {
		return toolFallback;
	}

	// Final fallback - generic message, never raw tool content
	return "I processed your request but couldn't generate a proper response. Please try again.";
}
