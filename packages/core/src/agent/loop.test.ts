import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../config/schema.js";
import type { GenerateOptions, GenerateResult, LLMProvider } from "../provider/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { InboundMessage } from "../types.js";
import { AgentLoop } from "./loop.js";
import type { StepCallback, StepEvent } from "./types.js";

const EMPTY_USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

type GenerateFn = (options: GenerateOptions) => Promise<GenerateResult>;

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
	return {
		workspace: "~/.featherbot/workspace",
		model: "anthropic/claude-sonnet-4-5-20250929",
		maxTokens: 8192,
		temperature: 0.7,
		maxToolIterations: 20,
		bootstrapFiles: ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md"],
		...overrides,
	};
}

function makeInbound(content: string, overrides?: Partial<InboundMessage>): InboundMessage {
	return {
		channel: "test",
		senderId: "user1",
		chatId: "chat1",
		content,
		timestamp: new Date(),
		media: [],
		metadata: {},
		messageId: "test-msg-1",
		...overrides,
	};
}

function makeResult(overrides?: Partial<GenerateResult>): GenerateResult {
	return {
		text: "Hello!",
		toolCalls: [],
		toolResults: [],
		usage: EMPTY_USAGE,
		finishReason: "stop",
		...overrides,
	};
}

function makeMockProvider(generateFn?: GenerateFn): LLMProvider {
	return {
		generate: generateFn ?? (async () => makeResult()),
		stream: async () => {
			throw new Error("stream not implemented");
		},
	};
}

function getCallOpts(spy: ReturnType<typeof vi.fn<GenerateFn>>, index: number): GenerateOptions {
	const call = spy.mock.calls[index];
	if (call === undefined) {
		throw new Error(`No call at index ${index}`);
	}
	return call[0];
}

describe("AgentLoop", () => {
	describe("processMessage", () => {
		it("returns a simple text response", async () => {
			const loop = new AgentLoop({
				provider: makeMockProvider(),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			const result = await loop.processMessage(makeInbound("hi"));
			expect(result.text).toBe("Hello!");
			expect(result.finishReason).toBe("stop");
			expect(result.steps).toBe(1);
			expect(result.toolCalls).toEqual([]);
			expect(result.toolResults).toEqual([]);
			expect(result.usage).toEqual(EMPTY_USAGE);
		});

		it("passes config values to provider.generate", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());
			const config = makeConfig({ temperature: 0.3, maxTokens: 4096, maxToolIterations: 10 });

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config,
			});

			await loop.processMessage(makeInbound("test"));

			expect(generateSpy).toHaveBeenCalledOnce();
			const opts = getCallOpts(generateSpy, 0);
			expect(opts.temperature).toBe(0.3);
			expect(opts.maxTokens).toBe(4096);
			expect(opts.maxSteps).toBe(10);
		});

		it("assembles system prompt + history + user message", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				systemPrompt: "Custom prompt",
			});

			await loop.processMessage(makeInbound("hello"));

			const opts = getCallOpts(generateSpy, 0);
			const messages = opts.messages;
			expect(messages[0]).toEqual({ role: "system", content: "Custom prompt" });
			expect(messages[messages.length - 1]).toEqual({ role: "user", content: "hello" });
		});

		it("returns tool calls and results", async () => {
			const toolCalls = [{ id: "tc1", name: "echo", arguments: { input: "hi" } }];
			const toolResults = [{ toolCallId: "tc1", toolName: "echo", content: "hi" }];

			const loop = new AgentLoop({
				provider: makeMockProvider(async () =>
					makeResult({ toolCalls, toolResults, text: "Done" }),
				),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			const result = await loop.processMessage(makeInbound("test"));
			expect(result.toolCalls).toEqual(toolCalls);
			expect(result.toolResults).toEqual(toolResults);
			expect(result.steps).toBe(2);
		});

		it("supports multi-turn conversation with history", async () => {
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `Response ${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processMessage(makeInbound("first"));
			const result2 = await loop.processMessage(makeInbound("second"));

			expect(result2.text).toBe("Response 2");

			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// system + history(user "first" + assistant "Response 1") + user "second"
			expect(messages.length).toBe(4);
			expect(messages[1]).toEqual({ role: "user", content: "first" });
			expect(messages[2]).toEqual({ role: "assistant", content: "Response 1" });
			expect(messages[3]).toEqual({ role: "user", content: "second" });
		});

		it("handles LLM error response", async () => {
			const loop = new AgentLoop({
				provider: makeMockProvider(async () =>
					makeResult({ text: "[LLM Error] API key invalid", finishReason: "error" }),
				),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			const result = await loop.processMessage(makeInbound("test"));
			expect(result.text).toBe("[LLM Error] API key invalid");
			expect(result.finishReason).toBe("error");
		});

		it("handles empty user message", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			const result = await loop.processMessage(makeInbound(""));
			expect(result.text).toBe("Hello!");

			const opts = getCallOpts(generateSpy, 0);
			const lastMsg = opts.messages[opts.messages.length - 1];
			expect(lastMsg).toEqual({ role: "user", content: "" });
		});

		it("uses default system prompt when none provided", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processMessage(makeInbound("test"));

			const opts = getCallOpts(generateSpy, 0);
			expect(opts.messages[0]).toEqual({
				role: "system",
				content: "You are FeatherBot, a helpful AI assistant.",
			});
		});

		it("does not pass tools when registry is empty", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processMessage(makeInbound("test"));

			const opts = getCallOpts(generateSpy, 0);
			expect(opts.tools).toBeUndefined();
		});

		it("isolates sessions by channel:chatId", async () => {
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `R${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processMessage(makeInbound("a", { channel: "tg", chatId: "1" }));
			await loop.processMessage(makeInbound("b", { channel: "tg", chatId: "2" }));
			await loop.processMessage(makeInbound("c", { channel: "tg", chatId: "1" }));

			// 3rd call (chatId "1") should have history from 1st call only
			const opts = getCallOpts(generateSpy, 2);
			const messages = opts.messages;
			// system + history(user "a" + assistant "R1") + user "c"
			expect(messages.length).toBe(4);
			expect(messages[1]).toEqual({ role: "user", content: "a" });
		});
	});

	describe("processDirect", () => {
		it("returns a simple text response", async () => {
			const loop = new AgentLoop({
				provider: makeMockProvider(),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			const result = await loop.processDirect("hi");
			expect(result.text).toBe("Hello!");
			expect(result.finishReason).toBe("stop");
		});

		it("uses default system prompt when no override provided", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processDirect("test");

			const opts = getCallOpts(generateSpy, 0);
			expect(opts.messages[0]).toEqual({
				role: "system",
				content: "You are FeatherBot, a helpful AI assistant.",
			});
		});

		it("overrides system prompt for this call only", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				systemPrompt: "Instance prompt",
			});

			await loop.processDirect("first", { systemPrompt: "Override prompt" });
			await loop.processDirect("second");

			const opts1 = getCallOpts(generateSpy, 0);
			expect(opts1.messages[0]).toEqual({ role: "system", content: "Override prompt" });

			const opts2 = getCallOpts(generateSpy, 1);
			expect(opts2.messages[0]).toEqual({ role: "system", content: "Instance prompt" });
		});

		it("uses default sessionKey 'direct:default'", async () => {
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `R${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processDirect("first");
			await loop.processDirect("second");

			// Second call should have history from the first (same default session)
			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// system + history(user "first" + assistant "R1") + user "second"
			expect(messages.length).toBe(4);
			expect(messages[1]).toEqual({ role: "user", content: "first" });
			expect(messages[2]).toEqual({ role: "assistant", content: "R1" });
		});

		it("isolates separate session keys", async () => {
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `R${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processDirect("a", { sessionKey: "cli:session1" });
			await loop.processDirect("b", { sessionKey: "cli:session2" });
			await loop.processDirect("c", { sessionKey: "cli:session1" });

			// 3rd call (session1) should have history from 1st call only
			const opts = getCallOpts(generateSpy, 2);
			const messages = opts.messages;
			// system + history(user "a" + assistant "R1") + user "c"
			expect(messages.length).toBe(4);
			expect(messages[1]).toEqual({ role: "user", content: "a" });
		});

		it("skipHistory: true does not add messages to history", async () => {
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `R${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			// First call with skipHistory: true
			await loop.processDirect("extraction prompt", {
				sessionKey: "telegram:123",
				skipHistory: true,
			});

			// Second call WITHOUT skipHistory — should have NO history from first call
			await loop.processDirect("real message", { sessionKey: "telegram:123" });

			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// system + user "real message" (no history from first call)
			expect(messages.length).toBe(2);
			expect(messages[1]).toEqual({ role: "user", content: "real message" });
		});

		it("skipHistory: true still sees existing history as context", async () => {
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `R${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			// First call adds to history normally
			await loop.processDirect("first message", { sessionKey: "telegram:123" });

			// Second call with skipHistory: true — should SEE first message in context
			await loop.processDirect("extraction prompt", {
				sessionKey: "telegram:123",
				skipHistory: true,
			});

			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// system + history(user "first message" + assistant "R1") + user "extraction prompt"
			expect(messages.length).toBe(4);
			expect(messages[1]).toEqual({ role: "user", content: "first message" });
			expect(messages[2]).toEqual({ role: "assistant", content: "R1" });
			expect(messages[3]).toEqual({ role: "user", content: "extraction prompt" });
		});

		it("does not share history with processMessage sessions", async () => {
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `R${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processMessage(makeInbound("from channel"));
			await loop.processDirect("from direct");

			// processDirect should have no history (different session key)
			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// system + user "from direct" (no history)
			expect(messages.length).toBe(2);
		});
	});

	describe("error handling and callbacks", () => {
		it("adds LLM error text to history for self-correction", async () => {
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				if (callCount === 1) {
					return makeResult({ text: "[LLM Error] rate limited", finishReason: "error" });
				}
				return makeResult({ text: "Recovered" });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processMessage(makeInbound("first"));
			await loop.processMessage(makeInbound("retry"));

			// Second call should see the error in history
			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// system + history(user "first" + assistant "[LLM Error]...") + user "retry"
			expect(messages.length).toBe(4);
			expect(messages[2]).toEqual({
				role: "assistant",
				content: "[LLM Error] rate limited",
			});
		});

		it("invokes onStepFinish callback with step event", async () => {
			const stepEvents: StepEvent[] = [];
			const onStepFinish: StepCallback = (event) => {
				stepEvents.push(event);
			};

			const loop = new AgentLoop({
				provider: makeMockProvider(),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				onStepFinish,
			});

			await loop.processMessage(makeInbound("test"));

			expect(stepEvents.length).toBe(1);
			expect(stepEvents[0]).toEqual({
				stepNumber: 1,
				text: "Hello!",
				toolCalls: [],
				toolResults: [],
				usage: EMPTY_USAGE,
			});
		});

		it("invokes onStepFinish with tool call step count", async () => {
			const toolCalls = [{ id: "tc1", name: "echo", arguments: { input: "hi" } }];
			const toolResults = [{ toolCallId: "tc1", toolName: "echo", content: "hi" }];
			const stepEvents: StepEvent[] = [];

			const loop = new AgentLoop({
				provider: makeMockProvider(async () =>
					makeResult({ toolCalls, toolResults, text: "Done" }),
				),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				onStepFinish: (event) => stepEvents.push(event),
			});

			await loop.processMessage(makeInbound("test"));

			expect(stepEvents.length).toBe(1);
			expect(stepEvents[0]?.stepNumber).toBe(2);
			expect(stepEvents[0]?.toolCalls).toEqual(toolCalls);
			expect(stepEvents[0]?.toolResults).toEqual(toolResults);
		});

		it("does not crash when onStepFinish callback throws", async () => {
			const loop = new AgentLoop({
				provider: makeMockProvider(),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				onStepFinish: () => {
					throw new Error("callback exploded");
				},
			});

			const result = await loop.processMessage(makeInbound("test"));
			expect(result.text).toBe("Hello!");
			expect(result.finishReason).toBe("stop");
		});

		it("does not invoke callback when onStepFinish is not provided", async () => {
			const loop = new AgentLoop({
				provider: makeMockProvider(),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			// Should complete without error (no callback to invoke)
			const result = await loop.processMessage(makeInbound("test"));
			expect(result.text).toBe("Hello!");
		});
	});

	describe("context builder integration", () => {
		async function makeTempWorkspace(): Promise<string> {
			const raw = await mkdtemp(join(tmpdir(), "loop-ctx-test-"));
			return realpath(raw);
		}

		it("uses context builder when workspacePath is provided", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "AGENTS.md"), "You are a test agent");
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig({ bootstrapFiles: ["AGENTS.md"] }),
				workspacePath: ws,
			});

			await loop.processMessage(makeInbound("hello"));

			const opts = getCallOpts(generateSpy, 0);
			const systemMsg = opts.messages[0];
			expect(systemMsg?.content).toContain("## Identity");
			expect(systemMsg?.content).toContain("## AGENTS.md\nYou are a test agent");
		});

		it("includes session context from inbound message", async () => {
			const ws = await makeTempWorkspace();
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig({ bootstrapFiles: [] }),
				workspacePath: ws,
			});

			await loop.processMessage(makeInbound("hi", { channel: "telegram", chatId: "42" }));

			const opts = getCallOpts(generateSpy, 0);
			const systemMsg = opts.messages[0];
			expect(systemMsg?.content).toContain("## Session");
			expect(systemMsg?.content).toContain("Channel: telegram");
			expect(systemMsg?.content).toContain("Chat ID: 42");
		});

		it("includes memory context when memoryStore is provided", async () => {
			const ws = await makeTempWorkspace();
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());
			const mockMemoryStore = {
				getMemoryContext: async () => "User prefers dark mode",
				getRecentMemories: async () => "",
				getMemoryFilePath: () => "",
				getDailyNotePath: () => "",
			};

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig({ bootstrapFiles: [] }),
				workspacePath: ws,
				memoryStore: mockMemoryStore,
			});

			await loop.processMessage(makeInbound("hi"));

			const opts = getCallOpts(generateSpy, 0);
			const systemMsg = opts.messages[0];
			expect(systemMsg?.content).toContain("## Memory\nUser prefers dark mode");
		});

		it("falls back to static prompt when no workspacePath", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processMessage(makeInbound("test"));

			const opts = getCallOpts(generateSpy, 0);
			expect(opts.messages[0]).toEqual({
				role: "system",
				content: "You are FeatherBot, a helpful AI assistant.",
			});
		});

		it("clears stale history once on first message of first-conversation", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(
				join(ws, "USER.md"),
				"# User Profile\n\n- Name: (your name here)\n- Timezone: (your timezone)",
			);

			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `Response ${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig({ bootstrapFiles: ["USER.md"] }),
				workspacePath: ws,
			});

			// First message clears stale history — only system + user
			await loop.processMessage(makeInbound("hello", { channel: "tg", chatId: "1" }));
			const opts1 = getCallOpts(generateSpy, 0);
			expect(opts1.messages.length).toBe(2);
			expect(opts1.messages[0]?.content).toContain("## First Conversation");
			expect(opts1.messages[1]).toEqual({ role: "user", content: "hello" });
		});

		it("preserves onboarding history on subsequent first-conversation messages", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(
				join(ws, "USER.md"),
				"# User Profile\n\n- Name: (your name here)\n- Timezone: (your timezone)",
			);

			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `Response ${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig({ bootstrapFiles: ["USER.md"] }),
				workspacePath: ws,
			});

			// Turn 1: stale history cleared, bot introduces itself
			await loop.processMessage(makeInbound("hello", { channel: "tg", chatId: "1" }));
			// Turn 2: USER.md still has placeholders, but history is NOT cleared again
			await loop.processMessage(makeInbound("I'm Alice", { channel: "tg", chatId: "1" }));

			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// system + history(user "hello" + assistant "Response 1") + user "I'm Alice"
			expect(messages.length).toBe(4);
			expect(messages[1]).toEqual({ role: "user", content: "hello" });
			expect(messages[2]).toEqual({ role: "assistant", content: "Response 1" });
			expect(messages[3]).toEqual({ role: "user", content: "I'm Alice" });
		});

		it("preserves session history when isFirstConversation is false", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(
				join(ws, "USER.md"),
				"# User Profile\n\n- Name: Alice\n- Timezone: America/New_York",
			);

			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `Response ${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig({ bootstrapFiles: ["USER.md"] }),
				workspacePath: ws,
			});

			await loop.processMessage(makeInbound("hello", { channel: "tg", chatId: "1" }));
			await loop.processMessage(makeInbound("how are you", { channel: "tg", chatId: "1" }));

			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// History preserved: system + user "hello" + assistant "Response 1" + user "how are you"
			expect(messages.length).toBe(4);
			expect(messages[1]).toEqual({ role: "user", content: "hello" });
			expect(messages[2]).toEqual({ role: "assistant", content: "Response 1" });
			expect(messages[3]).toEqual({ role: "user", content: "how are you" });
		});

		it("processDirect uses context builder when workspacePath is provided", async () => {
			const ws = await makeTempWorkspace();
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig({ bootstrapFiles: [] }),
				workspacePath: ws,
			});

			await loop.processDirect("hello");

			const opts = getCallOpts(generateSpy, 0);
			const systemMsg = opts.messages[0];
			expect(systemMsg?.content).toContain("## Identity");
		});
	});

	describe("session database integration", () => {
		async function makeTempDbPath(): Promise<string> {
			const raw = await mkdtemp(join(tmpdir(), "loop-session-test-"));
			const dir = await realpath(raw);
			return join(dir, "sessions.db");
		}

		it("persists messages with sessionDbPath", async () => {
			const dbPath = await makeTempDbPath();
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `Response ${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				sessionConfig: { dbPath, maxMessages: 50 },
			});

			await loop.processMessage(makeInbound("hello", { channel: "tg", chatId: "42" }));

			// Verify messages were persisted in SQLite
			const db = new Database(dbPath);
			const rows = db.prepare("SELECT role, content FROM messages ORDER BY id ASC").all() as {
				role: string;
				content: string;
			}[];
			db.close();

			expect(rows.length).toBe(2);
			expect(rows[0]).toEqual({ role: "user", content: "hello" });
			expect(rows[1]).toEqual({ role: "assistant", content: "Response 1" });
		});

		it("creates session metadata row", async () => {
			const dbPath = await makeTempDbPath();

			const loop = new AgentLoop({
				provider: makeMockProvider(),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				sessionConfig: { dbPath, maxMessages: 50 },
			});

			await loop.processMessage(makeInbound("hi", { channel: "telegram", chatId: "99" }));

			const db = new Database(dbPath);
			const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get("telegram:99") as {
				id: string;
				channel: string;
				chat_id: string;
			};
			db.close();

			expect(row).toBeDefined();
			expect(row.channel).toBe("telegram");
			expect(row.chat_id).toBe("99");
		});

		it("falls back to InMemoryHistory without sessionConfig", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
			});

			await loop.processMessage(makeInbound("first"));
			await loop.processMessage(makeInbound("second"));

			// History should work (in-memory) — second call has history from first
			const opts = getCallOpts(generateSpy, 1);
			expect(opts.messages.length).toBe(4);
		});

		it("falls back to InMemoryHistory when dbPath is empty string", async () => {
			const generateSpy = vi.fn<GenerateFn>(async () => makeResult());

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				sessionConfig: { dbPath: "", maxMessages: 50 },
			});

			await loop.processMessage(makeInbound("first"));
			await loop.processMessage(makeInbound("second"));

			// History should work (in-memory) — second call has history from first
			const opts = getCallOpts(generateSpy, 1);
			expect(opts.messages.length).toBe(4);
		});

		it("reuses history instance for same session key", async () => {
			const dbPath = await makeTempDbPath();
			let callCount = 0;
			const generateSpy = vi.fn<GenerateFn>(async () => {
				callCount++;
				return makeResult({ text: `R${callCount}` });
			});

			const loop = new AgentLoop({
				provider: makeMockProvider(generateSpy),
				toolRegistry: new ToolRegistry(),
				config: makeConfig(),
				sessionConfig: { dbPath, maxMessages: 50 },
			});

			await loop.processMessage(makeInbound("first", { channel: "tg", chatId: "1" }));
			await loop.processMessage(makeInbound("second", { channel: "tg", chatId: "1" }));

			// Second call should have history from first call
			const opts = getCallOpts(generateSpy, 1);
			const messages = opts.messages;
			// system + history(user "first" + assistant "R1") + user "second"
			expect(messages.length).toBe(4);
			expect(messages[1]).toEqual({ role: "user", content: "first" });
			expect(messages[2]).toEqual({ role: "assistant", content: "R1" });
		});
	});
});
