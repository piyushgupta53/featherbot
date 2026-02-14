import type { LLMMessage, LLMProvider } from "../provider/types.js";

const SUMMARY_PREFIX = "[CONVERSATION SUMMARY]\n";

export interface ConversationSummarizerOptions {
	provider: LLMProvider;
	model?: string;
}

/**
 * Summarizes evicted conversation messages into a rolling summary.
 * The summary is stored as a system-role message at the start of history.
 */
export class ConversationSummarizer {
	private readonly provider: LLMProvider;
	private readonly model?: string;

	constructor(options: ConversationSummarizerOptions) {
		this.provider = options.provider;
		this.model = options.model;
	}

	/**
	 * Summarize messages that are about to be evicted. If an existing summary
	 * is provided, the new summary will be cumulative (appended to it).
	 */
	async summarize(evictedMessages: LLMMessage[], existingSummary?: string): Promise<string> {
		if (evictedMessages.length === 0) {
			return existingSummary ?? "";
		}

		const conversationText = evictedMessages
			.filter((m) => m.role === "user" || m.role === "assistant")
			.map((m) => `${m.role}: ${m.content}`)
			.join("\n");

		if (!conversationText.trim()) {
			return existingSummary ?? "";
		}

		const prompt = buildSummarizationPrompt(conversationText, existingSummary);

		try {
			const result = await this.provider.generate({
				model: this.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.3,
				maxTokens: 1024,
			});

			const summary = result.text.trim();
			if (!summary || summary.startsWith("[LLM Error]")) {
				console.warn("[summarizer] LLM returned error, keeping existing summary");
				return existingSummary ?? "";
			}

			return summary;
		} catch (err) {
			console.warn("[summarizer] summarization failed:", err);
			return existingSummary ?? "";
		}
	}
}

function buildSummarizationPrompt(conversationText: string, existingSummary?: string): string {
	const parts: string[] = [];
	parts.push(
		"You are a conversation summarizer. Create a concise summary of the conversation below.",
	);
	parts.push(
		"Focus on: key topics discussed, decisions made, user requests, important context, and any unresolved threads.",
	);
	parts.push("Be concise but preserve critical details. Use bullet points.");

	if (existingSummary) {
		parts.push("");
		parts.push("Previous conversation summary:");
		parts.push("---");
		parts.push(existingSummary);
		parts.push("---");
		parts.push("");
		parts.push("Incorporate the previous summary and add the new conversation details below:");
	}

	parts.push("");
	parts.push("Conversation to summarize:");
	parts.push("---");
	parts.push(conversationText);
	parts.push("---");
	parts.push("");
	parts.push("Provide a concise, cumulative summary:");

	return parts.join("\n");
}

/**
 * Check if a message is a conversation summary message.
 */
export function isSummaryMessage(msg: LLMMessage): boolean {
	return msg.role === "system" && msg.content.startsWith(SUMMARY_PREFIX);
}

/**
 * Create a system message containing the conversation summary.
 */
export function createSummaryMessage(summary: string): LLMMessage {
	return {
		role: "system",
		content: `${SUMMARY_PREFIX}${summary}`,
	};
}

/**
 * Extract the summary text from a summary message.
 */
export function extractSummaryText(msg: LLMMessage): string {
	if (!isSummaryMessage(msg)) return "";
	return msg.content.slice(SUMMARY_PREFIX.length);
}
