import { describe, expect, it } from "vitest";
import { buildSubagentResultPrompt } from "./subagent-result-prompt.js";
import { BUILTIN_SPECS } from "./subagent-specs.js";
import type { SubagentState } from "./subagent-types.js";

function makeState(
	overrides: Partial<SubagentState> & { id: string; task: string; status: SubagentState["status"] },
): SubagentState {
	return {
		startedAt: new Date("2026-02-09T10:00:00Z"),
		originChannel: "telegram",
		originChatId: "12345",
		spec: BUILTIN_SPECS.general,
		abortController: new AbortController(),
		...overrides,
	};
}

describe("buildSubagentResultPrompt", () => {
	it("generates a summarization prompt for completed tasks", () => {
		const state = makeState({
			id: "test-id",
			task: "Research the best credit cards for travel rewards",
			status: "completed",
			result: "Top 3 cards: Chase Sapphire Reserve, Amex Gold, Capital One Venture X",
			completedAt: new Date("2026-02-09T10:01:00Z"),
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).toContain("background task you spawned has completed");
		expect(prompt).toContain("Research the best credit cards for travel rewards");
		expect(prompt).toContain("Top 3 cards: Chase Sapphire Reserve");
		expect(prompt).toContain("conversational");
		expect(prompt).toContain("Reference the original task naturally");
	});

	it("generates an error prompt for failed tasks", () => {
		const state = makeState({
			id: "test-id",
			task: "Fetch weather data from API",
			status: "failed",
			error: "Network timeout after 30s",
			completedAt: new Date("2026-02-09T10:00:30Z"),
			originChannel: "whatsapp",
			originChatId: "67890",
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).toContain("background task you spawned has failed");
		expect(prompt).toContain("Fetch weather data from API");
		expect(prompt).toContain("Network timeout after 30s");
		expect(prompt).toContain("retry or suggest an alternative");
	});

	it("handles completed task with no result", () => {
		const state = makeState({
			id: "test-id",
			task: "Clean up temp files",
			status: "completed",
			completedAt: new Date("2026-02-09T10:00:05Z"),
			originChannel: "terminal",
			originChatId: "cli",
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).toContain("(no result)");
		expect(prompt).toContain("Clean up temp files");
	});

	it("handles failed task with no error message", () => {
		const state = makeState({
			id: "test-id",
			task: "Process data",
			status: "failed",
			completedAt: new Date("2026-02-09T10:00:10Z"),
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).toContain("(unknown error)");
		expect(prompt).toContain("Process data");
	});

	it("does not mention sub-agent in instructions", () => {
		const completedState = makeState({
			id: "test-id",
			task: "Do something",
			status: "completed",
			result: "Done",
		});

		const failedState = makeState({
			id: "test-id",
			task: "Do something",
			status: "failed",
			error: "Oops",
		});

		const completedPrompt = buildSubagentResultPrompt(completedState);
		const failedPrompt = buildSubagentResultPrompt(failedState);

		expect(completedPrompt).toContain("Do NOT mention");
		expect(failedPrompt).toContain("Do NOT mention");
	});

	it("generates a cancellation prompt for cancelled tasks", () => {
		const state = makeState({
			id: "test-id",
			task: "Long running analysis",
			status: "cancelled",
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).toContain("was cancelled");
		expect(prompt).toContain("Long running analysis");
		expect(prompt).toContain("retry or take a different approach");
	});

	it("includes spec label for non-general specs", () => {
		const state = makeState({
			id: "test-id",
			task: "Research topic",
			status: "completed",
			result: "Found info",
			spec: BUILTIN_SPECS.researcher,
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).toContain("(researcher)");
	});

	it("uses fallback when result is empty string", () => {
		const state = makeState({
			id: "test-id",
			task: "Research something",
			status: "completed",
			result: "",
			completedAt: new Date("2026-02-09T10:00:05Z"),
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).toContain("(no result)");
	});

	it("uses fallback when result is whitespace only", () => {
		const state = makeState({
			id: "test-id",
			task: "Research something",
			status: "completed",
			result: "   \n\t  ",
			completedAt: new Date("2026-02-09T10:00:05Z"),
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).toContain("(no result)");
	});

	it("omits spec label for general spec", () => {
		const state = makeState({
			id: "test-id",
			task: "Do something",
			status: "completed",
			result: "Done",
			spec: BUILTIN_SPECS.general,
		});

		const prompt = buildSubagentResultPrompt(state);

		expect(prompt).not.toContain("(general)");
	});
});
