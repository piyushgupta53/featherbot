import { describe, expect, it, vi } from "vitest";
import { BUILTIN_SPECS } from "../agent/subagent-specs.js";
import type { SubagentState } from "../agent/subagent-types.js";
import type { SubagentManager } from "../agent/subagent.js";
import { SpawnTool, SubagentStatusTool, captureParentContext } from "./spawn-tool.js";
import type { SpawnToolOriginContext } from "./spawn-tool.js";

function makeMockManager(overrides?: Partial<SubagentManager>): SubagentManager {
	return {
		spawn: vi.fn(() => "mock-task-id"),
		cancel: vi.fn(() => true),
		getState: vi.fn(() => undefined),
		listActive: vi.fn(() => []),
		listAll: vi.fn(() => []),
		...overrides,
	} as unknown as SubagentManager;
}

function makeOriginContext(): SpawnToolOriginContext {
	return { channel: "telegram", chatId: "123" };
}

function makeState(overrides?: Partial<SubagentState>): SubagentState {
	return {
		id: "test-id",
		task: "test task",
		status: "running",
		startedAt: new Date("2026-01-01T00:00:00Z"),
		originChannel: "telegram",
		originChatId: "123",
		spec: BUILTIN_SPECS.general,
		abortController: new AbortController(),
		...overrides,
	};
}

describe("SpawnTool", () => {
	it("execute with valid task returns success message containing task ID", async () => {
		const manager = makeMockManager();
		const tool = new SpawnTool(manager, makeOriginContext());

		const result = await tool.execute({ task: "do something" });

		expect(result).toContain("mock-task-id");
		expect(result).toContain("Sub-agent spawned successfully");
		expect(result).toContain("do something");
	});

	it("execute passes origin context and type to SubagentManager", async () => {
		const spawnSpy = vi.fn(() => "id-1");
		const manager = makeMockManager({ spawn: spawnSpy } as unknown as Partial<SubagentManager>);
		const context = { channel: "whatsapp", chatId: "456" };
		const tool = new SpawnTool(manager, context);

		await tool.execute({ task: "my task", type: "researcher" });

		expect(spawnSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				task: "my task",
				originChannel: "whatsapp",
				originChatId: "456",
				type: "researcher",
			}),
		);
	});

	it("includes parent context when getParentHistory is provided", async () => {
		const spawnSpy = vi.fn(() => "id-1");
		const manager = makeMockManager({ spawn: spawnSpy } as unknown as Partial<SubagentManager>);
		const tool = new SpawnTool(manager, makeOriginContext(), {
			getParentHistory: () => [
				{ role: "user", content: "Hello there" },
				{ role: "assistant", content: "Hi! How can I help?" },
			],
		});

		await tool.execute({ task: "some task" });

		expect(spawnSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				parentContext: expect.stringContaining("Hello there"),
			}),
		);
	});

	it("parameters schema validates task as required string", () => {
		const tool = new SpawnTool(makeMockManager(), makeOriginContext());

		const validResult = tool.parameters.safeParse({ task: "hello" });
		expect(validResult.success).toBe(true);

		const invalidResult = tool.parameters.safeParse({});
		expect(invalidResult.success).toBe(false);

		const wrongType = tool.parameters.safeParse({ task: 123 });
		expect(wrongType.success).toBe(false);
	});

	it("parameters schema accepts optional type", () => {
		const tool = new SpawnTool(makeMockManager(), makeOriginContext());

		const withType = tool.parameters.safeParse({ task: "hello", type: "researcher" });
		expect(withType.success).toBe(true);

		const invalidType = tool.parameters.safeParse({ task: "hello", type: "invalid" });
		expect(invalidType.success).toBe(false);
	});
});

describe("SubagentStatusTool", () => {
	it("execute with specific ID returns that sub-agent status", async () => {
		const state = makeState({
			id: "abc-123",
			task: "research topic",
			status: "completed",
			result: "Found the answer",
			completedAt: new Date("2026-01-01T00:05:00Z"),
			spec: BUILTIN_SPECS.researcher,
		});
		const manager = makeMockManager({
			getState: vi.fn(() => state),
		} as unknown as Partial<SubagentManager>);

		const tool = new SubagentStatusTool(manager);
		const result = await tool.execute({ id: "abc-123" });

		expect(result).toContain("abc-123");
		expect(result).toContain("researcher");
		expect(result).toContain("research topic");
		expect(result).toContain("completed");
		expect(result).toContain("Found the answer");
	});

	it("execute without ID returns list of active sub-agents", async () => {
		const active = [
			makeState({ id: "id-1", task: "task one" }),
			makeState({ id: "id-2", task: "task two" }),
		];
		const manager = makeMockManager({
			listActive: vi.fn(() => active),
		} as unknown as Partial<SubagentManager>);

		const tool = new SubagentStatusTool(manager);
		const result = await tool.execute({});

		expect(result).toContain("Active sub-agents");
		expect(result).toContain("id-1");
		expect(result).toContain("task one");
		expect(result).toContain("id-2");
		expect(result).toContain("task two");
	});

	it("returns 'No active sub-agents' when none running", async () => {
		const manager = makeMockManager();
		const tool = new SubagentStatusTool(manager);

		const result = await tool.execute({});
		expect(result).toBe("No active sub-agents.");
	});

	it("returns not found for unknown ID", async () => {
		const manager = makeMockManager();
		const tool = new SubagentStatusTool(manager);

		const result = await tool.execute({ id: "nonexistent" });
		expect(result).toContain("No sub-agent found");
		expect(result).toContain("nonexistent");
	});

	it("cancel action cancels a running sub-agent", async () => {
		const cancelSpy = vi.fn(() => true);
		const manager = makeMockManager({ cancel: cancelSpy } as unknown as Partial<SubagentManager>);
		const tool = new SubagentStatusTool(manager);

		const result = await tool.execute({ id: "abc-123", action: "cancel" });

		expect(cancelSpy).toHaveBeenCalledWith("abc-123");
		expect(result).toContain("has been cancelled");
	});

	it("cancel action without ID returns error", async () => {
		const tool = new SubagentStatusTool(makeMockManager());

		const result = await tool.execute({ action: "cancel" });
		expect(result).toContain("Error");
		expect(result).toContain("id");
	});
});

describe("captureParentContext", () => {
	it("captures recent user/assistant messages", () => {
		const messages = [
			{ role: "user" as const, content: "What is TypeScript?" },
			{ role: "assistant" as const, content: "TypeScript is a typed superset of JavaScript." },
			{ role: "user" as const, content: "Tell me more" },
		];

		const context = captureParentContext(messages);

		expect(context).toContain("User: What is TypeScript?");
		expect(context).toContain("Assistant: TypeScript is a typed superset of JavaScript.");
		expect(context).toContain("User: Tell me more");
	});

	it("filters out non-conversational messages", () => {
		const messages = [
			{ role: "system" as const, content: "You are helpful" },
			{ role: "user" as const, content: "Hello" },
			{ role: "tool" as const, content: "tool output", toolCallId: "tc1" },
			{ role: "assistant" as const, content: "Hi there" },
		];

		const context = captureParentContext(messages);

		expect(context).not.toContain("You are helpful");
		expect(context).not.toContain("tool output");
		expect(context).toContain("User: Hello");
		expect(context).toContain("Assistant: Hi there");
	});

	it("truncates long messages", () => {
		const longContent = "x".repeat(3000);
		const messages = [{ role: "user" as const, content: longContent }];

		const context = captureParentContext(messages);

		expect(context.length).toBeLessThan(longContent.length);
		expect(context).toContain("...");
	});
});
