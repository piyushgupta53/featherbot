import type Database from "better-sqlite3";
import type { LLMMessage } from "../provider/types.js";
import { initDatabase } from "../session/database.js";
import { SessionStore } from "../session/session-store.js";
import { SqliteHistory } from "../session/sqlite-history.js";
import type { InboundMessage, SessionKey } from "../types.js";
import { ContextBuilder } from "./context-builder.js";
import type { SessionContext } from "./context-builder.js";
import { InMemoryHistory } from "./history.js";
import { buildToolMap } from "./tool-bridge.js";
import type { AgentLoopOptions, AgentLoopResult, ConversationHistory, StepEvent } from "./types.js";

const DEFAULT_SYSTEM_PROMPT = "You are FeatherBot, a helpful AI assistant.";

export class AgentLoop {
	private readonly options: AgentLoopOptions;
	private readonly sessions = new Map<SessionKey, ConversationHistory>();
	private readonly systemPrompt: string;
	private readonly contextBuilder?: ContextBuilder;
	private readonly db?: Database.Database;
	private readonly sessionStore?: SessionStore;
	private readonly maxMessages: number;

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
			});
		}
	}

	async processMessage(inbound: InboundMessage): Promise<AgentLoopResult> {
		const sessionKey: SessionKey = `${inbound.channel}:${inbound.chatId}`;
		const sessionContext: SessionContext = {
			channelName: inbound.channel,
			chatId: inbound.chatId,
		};
		const prompt = await this.resolveSystemPrompt(this.systemPrompt, sessionContext);
		return this.run(sessionKey, inbound.content, prompt);
	}

	async processDirect(
		message: string,
		options?: { systemPrompt?: string; sessionKey?: string },
	): Promise<AgentLoopResult> {
		const sessionKey: SessionKey = (options?.sessionKey as SessionKey) ?? "direct:default";
		const staticPrompt = options?.systemPrompt ?? this.systemPrompt;
		const prompt = await this.resolveSystemPrompt(staticPrompt);
		return this.run(sessionKey, message, prompt);
	}

	private getOrCreateHistory(sessionKey: SessionKey): ConversationHistory {
		let history = this.sessions.get(sessionKey);
		if (history === undefined) {
			if (this.db !== undefined && this.sessionStore !== undefined) {
				this.sessionStore.getOrCreate(sessionKey);
				history = new SqliteHistory(this.db, sessionKey, {
					maxMessages: this.maxMessages,
				});
			} else {
				history = new InMemoryHistory({ maxMessages: this.maxMessages });
			}
			this.sessions.set(sessionKey, history);
		}
		return history;
	}

	private async resolveSystemPrompt(
		fallback: string,
		sessionContext?: SessionContext,
	): Promise<string> {
		if (this.contextBuilder === undefined) {
			return fallback;
		}
		const result = await this.contextBuilder.build(sessionContext);
		return result.systemPrompt;
	}

	private async run(
		sessionKey: SessionKey,
		userContent: string,
		systemPrompt: string,
	): Promise<AgentLoopResult> {
		const history = this.getOrCreateHistory(sessionKey);
		const { provider, toolRegistry, config } = this.options;

		const toolMap = buildToolMap(toolRegistry);

		const messages: LLMMessage[] = [
			{ role: "system", content: systemPrompt },
			...history.getMessages(),
			{ role: "user", content: userContent },
		];

		const result = await provider.generate({
			messages,
			tools: Object.keys(toolMap).length > 0 ? toolMap : undefined,
			maxSteps: config.maxToolIterations,
			temperature: config.temperature,
			maxTokens: config.maxTokens,
		});

		const steps = result.toolCalls.length > 0 ? result.toolCalls.length + 1 : 1;

		history.add({ role: "user", content: userContent });
		if (result.text) {
			history.add({ role: "assistant", content: result.text });
		}

		if (this.sessionStore !== undefined) {
			this.sessionStore.touch(sessionKey);
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
