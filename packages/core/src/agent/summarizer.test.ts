import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../provider/types.js";
import {
	ConversationSummarizer,
	createSummaryMessage,
	extractSummaryText,
	isSummaryMessage,
} from "./summarizer.js";

function createMockProvider(responseText: string): LLMProvider {
	return {
		generate: vi.fn().mockResolvedValue({
			text: responseText,
			toolCalls: [],
			toolResults: [],
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			finishReason: "stop",
		}),
		stream: vi.fn(),
		generateStructured: vi.fn(),
	};
}

describe("ConversationSummarizer", () => {
	it("returns empty string for empty messages", async () => {
		const provider = createMockProvider("summary");
		const summarizer = new ConversationSummarizer({ provider });
		const result = await summarizer.summarize([]);
		expect(result).toBe("");
		expect(provider.generate).not.toHaveBeenCalled();
	});

	it("summarizes user/assistant messages", async () => {
		const provider = createMockProvider("- User asked about weather\n- Bot provided forecast");
		const summarizer = new ConversationSummarizer({ provider });

		const result = await summarizer.summarize([
			{ role: "user", content: "What's the weather?" },
			{ role: "assistant", content: "It's sunny today." },
		]);

		expect(result).toBe("- User asked about weather\n- Bot provided forecast");
		expect(provider.generate).toHaveBeenCalledTimes(1);
	});

	it("passes existing summary for cumulative updates", async () => {
		const provider = createMockProvider("cumulative summary");
		const summarizer = new ConversationSummarizer({ provider });

		await summarizer.summarize([{ role: "user", content: "New message" }], "previous summary");

		const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
		const prompt = call.messages[0].content;
		expect(prompt).toContain("previous summary");
	});

	it("returns existing summary on LLM error", async () => {
		const provider = createMockProvider("[LLM Error] something broke");
		const summarizer = new ConversationSummarizer({ provider });

		const result = await summarizer.summarize(
			[{ role: "user", content: "test" }],
			"existing summary",
		);

		expect(result).toBe("existing summary");
	});

	it("handles provider exceptions gracefully", async () => {
		const provider: LLMProvider = {
			generate: vi.fn().mockRejectedValue(new Error("network error")),
			stream: vi.fn(),
			generateStructured: vi.fn(),
		};
		const summarizer = new ConversationSummarizer({ provider });

		const result = await summarizer.summarize([{ role: "user", content: "test" }], "fallback");

		expect(result).toBe("fallback");
	});

	it("filters non-user/assistant messages", async () => {
		const provider = createMockProvider("filtered summary");
		const summarizer = new ConversationSummarizer({ provider });

		const result = await summarizer.summarize([
			{ role: "system", content: "System prompt" },
			{ role: "tool", content: "Tool result", toolCallId: "123" },
		]);

		expect(result).toBe("");
		expect(provider.generate).not.toHaveBeenCalled();
	});
});

describe("summary message helpers", () => {
	it("createSummaryMessage creates a system message with prefix", () => {
		const msg = createSummaryMessage("test summary");
		expect(msg.role).toBe("system");
		expect(msg.content).toBe("[CONVERSATION SUMMARY]\ntest summary");
	});

	it("isSummaryMessage detects summary messages", () => {
		expect(isSummaryMessage({ role: "system", content: "[CONVERSATION SUMMARY]\ntest" })).toBe(
			true,
		);
		expect(isSummaryMessage({ role: "system", content: "regular system" })).toBe(false);
		expect(isSummaryMessage({ role: "user", content: "[CONVERSATION SUMMARY]\ntest" })).toBe(false);
	});

	it("extractSummaryText extracts the summary", () => {
		const msg = createSummaryMessage("my summary text");
		expect(extractSummaryText(msg)).toBe("my summary text");
	});

	it("extractSummaryText returns empty for non-summary message", () => {
		expect(extractSummaryText({ role: "system", content: "not a summary" })).toBe("");
	});
});
