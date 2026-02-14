import type { LLMMessage } from "../provider/types.js";
import {
	type ConversationSummarizer,
	createSummaryMessage,
	extractSummaryText,
	isSummaryMessage,
} from "./summarizer.js";
import type { ConversationHistory } from "./types.js";

export class InMemoryHistory implements ConversationHistory {
	private messages: LLMMessage[] = [];
	private readonly maxMessages: number;
	private summarizer?: ConversationSummarizer;
	private summarizing = false;

	constructor(options?: { maxMessages?: number }) {
		this.maxMessages = options?.maxMessages ?? 50;
	}

	setSummarizer(summarizer: ConversationSummarizer): void {
		this.summarizer = summarizer;
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

		if (this.summarizer && !this.summarizing) {
			// Batch eviction: remove oldest 40% for summarization
			const evictCount = Math.floor(nonSystemMessages.length * 0.4);
			const evicted = nonSystemMessages.slice(0, evictCount);
			const kept = nonSystemMessages.slice(evictCount).slice(-available);
			this.messages = [...systemMessages, ...kept];

			if (evicted.length > 0) {
				this.summarizing = true;
				const existingSummaryMsg = systemMessages.find(isSummaryMessage);
				const existingSummary = existingSummaryMsg
					? extractSummaryText(existingSummaryMsg)
					: undefined;

				void this.summarizer
					.summarize(evicted, existingSummary)
					.then((summary) => {
						if (summary) {
							this.messages = this.messages.filter((m) => !isSummaryMessage(m));
							this.messages.unshift(createSummaryMessage(summary));
						}
					})
					.catch((err) => {
						console.warn("[history] summarization failed:", err);
					})
					.finally(() => {
						this.summarizing = false;
					});
			}
		} else {
			// Simple eviction: keep only the newest messages
			const kept = nonSystemMessages.slice(-available);
			this.messages = [...systemMessages, ...kept];
		}
	}
}
