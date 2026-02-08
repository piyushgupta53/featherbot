import { describe, expect, it, vi } from "vitest";
import type { FeatherBotConfig } from "../config/schema.js";
import { FeatherBotConfigSchema } from "../config/schema.js";
import type { GenerateOptions, GenerateResult, LLMProvider } from "../provider/types.js";
import type { SubagentState } from "./subagent-types.js";
import { SubagentManager } from "./subagent.js";

const EMPTY_USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function makeResult(overrides?: Partial<GenerateResult>): GenerateResult {
	return {
		text: "Task done",
		toolCalls: [],
		toolResults: [],
		usage: EMPTY_USAGE,
		finishReason: "stop",
		...overrides,
	};
}

function makeMockProvider(
	generateFn?: (options: GenerateOptions) => Promise<GenerateResult>,
): LLMProvider {
	return {
		generate: generateFn ?? (async () => makeResult()),
		stream: async () => {
			throw new Error("stream not implemented");
		},
	};
}

function makeConfig(overrides?: Partial<FeatherBotConfig>): FeatherBotConfig {
	const base = FeatherBotConfigSchema.parse({});
	return { ...base, ...overrides };
}

describe("SubagentManager", () => {
	it("spawn returns a string task ID", () => {
		const manager = new SubagentManager(makeMockProvider(), makeConfig(), () => {});
		const id = manager.spawn({
			task: "test task",
			originChannel: "telegram",
			originChatId: "123",
		});
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("spawned sub-agent state is running immediately after spawn", () => {
		const manager = new SubagentManager(makeMockProvider(), makeConfig(), () => {});
		const id = manager.spawn({
			task: "test task",
			originChannel: "telegram",
			originChatId: "123",
		});
		const state = manager.getState(id);
		expect(state).toBeDefined();
		expect(state?.status).toBe("running");
		expect(state?.task).toBe("test task");
		expect(state?.originChannel).toBe("telegram");
		expect(state?.originChatId).toBe("123");
	});

	it("sub-agent state transitions to completed when LLM finishes", async () => {
		const completedStates: SubagentState[] = [];
		const manager = new SubagentManager(makeMockProvider(), makeConfig(), (state) => {
			completedStates.push(state);
		});

		const id = manager.spawn({
			task: "do something",
			originChannel: "terminal",
			originChatId: "1",
		});

		// Wait for async completion
		await vi.waitFor(() => {
			expect(completedStates.length).toBe(1);
		});

		const state = manager.getState(id);
		expect(state?.status).toBe("completed");
		expect(state?.result).toBe("Task done");
		expect(state?.completedAt).toBeInstanceOf(Date);
	});

	it("onComplete callback is invoked with completed state", async () => {
		const onComplete = vi.fn();
		const manager = new SubagentManager(makeMockProvider(), makeConfig(), onComplete);

		manager.spawn({
			task: "complete me",
			originChannel: "terminal",
			originChatId: "1",
		});

		await vi.waitFor(() => {
			expect(onComplete).toHaveBeenCalledOnce();
		});

		const callArg = onComplete.mock.calls[0]?.[0] as SubagentState;
		expect(callArg.status).toBe("completed");
		expect(callArg.result).toBe("Task done");
	});

	it("sub-agent state transitions to failed when LLM errors", async () => {
		const provider = makeMockProvider(async () => {
			throw new Error("LLM exploded");
		});
		const completedStates: SubagentState[] = [];
		const manager = new SubagentManager(provider, makeConfig(), (state) => {
			completedStates.push(state);
		});

		const id = manager.spawn({
			task: "fail task",
			originChannel: "terminal",
			originChatId: "1",
		});

		await vi.waitFor(() => {
			expect(completedStates.length).toBe(1);
		});

		const state = manager.getState(id);
		expect(state?.status).toBe("failed");
		expect(state?.error).toBe("LLM exploded");
		expect(state?.completedAt).toBeInstanceOf(Date);
	});

	it("sub-agent times out after timeoutMs and state becomes failed with timeout error", async () => {
		vi.useFakeTimers();

		const provider = makeMockProvider(
			() => new Promise(() => {}), // Never resolves
		);
		const completedStates: SubagentState[] = [];
		const config = makeConfig({
			subagent: { maxIterations: 15, timeoutMs: 1000 },
		});
		const manager = new SubagentManager(provider, config, (state) => {
			completedStates.push(state);
		});

		const id = manager.spawn({
			task: "slow task",
			originChannel: "terminal",
			originChatId: "1",
		});

		await vi.advanceTimersByTimeAsync(1100);

		await vi.waitFor(() => {
			expect(completedStates.length).toBe(1);
		});

		const state = manager.getState(id);
		expect(state?.status).toBe("failed");
		expect(state?.error).toBe("Sub-agent timed out");

		vi.useRealTimers();
	});

	it("listActive returns only running sub-agents", async () => {
		const completedStates: SubagentState[] = [];
		const provider = makeMockProvider(async () => makeResult());
		const manager = new SubagentManager(provider, makeConfig(), (state) => {
			completedStates.push(state);
		});

		manager.spawn({ task: "task1", originChannel: "t", originChatId: "1" });
		// task1 will complete quickly

		await vi.waitFor(() => {
			expect(completedStates.length).toBe(1);
		});

		// After first completes, spawn another with a provider that never resolves
		const slowProvider = makeMockProvider(() => new Promise(() => {}));
		const manager2 = new SubagentManager(slowProvider, makeConfig(), () => {});
		manager2.spawn({ task: "task2", originChannel: "t", originChatId: "2" });

		const active = manager2.listActive();
		expect(active.length).toBe(1);
		expect(active[0]?.task).toBe("task2");

		// After completion, first manager should have no active
		expect(manager.listActive().length).toBe(0);
	});

	it("listAll returns all sub-agents regardless of status", async () => {
		const completedStates: SubagentState[] = [];
		const manager = new SubagentManager(makeMockProvider(), makeConfig(), (state) => {
			completedStates.push(state);
		});

		manager.spawn({ task: "task1", originChannel: "t", originChatId: "1" });

		await vi.waitFor(() => {
			expect(completedStates.length).toBe(1);
		});

		// After completion, listAll should still have it
		const all = manager.listAll();
		expect(all.length).toBe(1);
		expect(all[0]?.status).toBe("completed");
	});

	it("getState returns undefined for unknown ID", () => {
		const manager = new SubagentManager(makeMockProvider(), makeConfig(), () => {});
		expect(manager.getState("nonexistent-id")).toBeUndefined();
	});

	it("sub-agent tool registry does NOT include message, spawn, or cron tools", () => {
		const generateSpy = vi.fn(async (opts: GenerateOptions) => {
			// Check that tools don't include restricted tools
			if (opts.tools !== undefined) {
				const toolNames = Object.keys(opts.tools);
				expect(toolNames).not.toContain("spawn");
				expect(toolNames).not.toContain("subagent_status");
				expect(toolNames).not.toContain("cron");
				expect(toolNames).not.toContain("message");
				// Should have the 7 reduced tools (5 core + 2 web)
				expect(toolNames).toContain("exec");
				expect(toolNames).toContain("read_file");
				expect(toolNames).toContain("write_file");
				expect(toolNames).toContain("edit_file");
				expect(toolNames).toContain("list_dir");
				expect(toolNames).toContain("web_search");
				expect(toolNames).toContain("web_fetch");
				expect(toolNames.length).toBe(7);
			}
			return makeResult();
		});

		const manager = new SubagentManager(makeMockProvider(generateSpy), makeConfig(), () => {});

		manager.spawn({ task: "check tools", originChannel: "t", originChatId: "1" });

		// Give the async task time to call generate
		return vi.waitFor(() => {
			expect(generateSpy).toHaveBeenCalledOnce();
		});
	});
});
