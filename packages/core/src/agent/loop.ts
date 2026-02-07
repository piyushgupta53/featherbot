import type { LLMMessage } from "../provider/types.js";
import type { InboundMessage, SessionKey } from "../types.js";
import { InMemoryHistory } from "./history.js";
import { buildToolMap } from "./tool-bridge.js";
import type { AgentLoopOptions, AgentLoopResult, StepEvent } from "./types.js";

const DEFAULT_SYSTEM_PROMPT = "You are FeatherBot, a helpful AI assistant.";

export class AgentLoop {
	private readonly options: AgentLoopOptions;
	private readonly sessions = new Map<SessionKey, InMemoryHistory>();
	private readonly systemPrompt: string;

	constructor(options: AgentLoopOptions) {
		this.options = options;
		this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
	}

	async processMessage(inbound: InboundMessage): Promise<AgentLoopResult> {
		const sessionKey: SessionKey = `${inbound.channel}:${inbound.chatId}`;
		return this.run(sessionKey, inbound.content, this.systemPrompt);
	}

	async processDirect(
		message: string,
		options?: { systemPrompt?: string; sessionKey?: string },
	): Promise<AgentLoopResult> {
		const sessionKey: SessionKey = (options?.sessionKey as SessionKey) ?? "direct:default";
		const prompt = options?.systemPrompt ?? this.systemPrompt;
		return this.run(sessionKey, message, prompt);
	}

	private getOrCreateHistory(sessionKey: SessionKey): InMemoryHistory {
		let history = this.sessions.get(sessionKey);
		if (history === undefined) {
			history = new InMemoryHistory();
			this.sessions.set(sessionKey, history);
		}
		return history;
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
