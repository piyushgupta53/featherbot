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
});
