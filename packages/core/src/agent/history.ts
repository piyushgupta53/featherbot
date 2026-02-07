import type { LLMMessage } from "../provider/types.js";
import type { ConversationHistory } from "./types.js";

export class InMemoryHistory implements ConversationHistory {
	private messages: LLMMessage[] = [];
	private readonly maxMessages: number;

	constructor(options?: { maxMessages?: number }) {
		this.maxMessages = options?.maxMessages ?? 50;
	}

	add(message: LLMMessage): void {
		this.messages.push(message);
		this.trim();
	}

	getMessages(): LLMMessage[] {
		return [...this.messages];
	}

	clear(): void {
		this.messages = [];
	}

	get length(): number {
		return this.messages.length;
	}

	private trim(): void {
		if (this.messages.length <= this.maxMessages) {
			return;
		}

		const systemMessages: LLMMessage[] = [];
		const nonSystemMessages: LLMMessage[] = [];

		for (const msg of this.messages) {
			if (msg.role === "system") {
				systemMessages.push(msg);
			} else {
				nonSystemMessages.push(msg);
			}
		}

		const available = this.maxMessages - systemMessages.length;
		const trimmed = nonSystemMessages.slice(-available);
		this.messages = [...systemMessages, ...trimmed];
	}
}
