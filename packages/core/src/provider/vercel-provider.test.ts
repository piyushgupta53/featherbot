import { describe, expect, it, vi } from "vitest";
import type { StreamPart } from "./types.js";
import { VercelLLMProvider } from "./vercel-provider.js";

vi.mock("@ai-sdk/anthropic", () => {
	const mockModel = { modelId: "mock-anthropic", provider: "anthropic" };
	const mockProvider = vi.fn(() => mockModel);
	return { createAnthropic: vi.fn(() => mockProvider) };
});

vi.mock("@ai-sdk/openai", () => {
	const mockModel = { modelId: "mock-openai", provider: "openai" };
	const mockProvider = vi.fn(() => mockModel);
	return { createOpenAI: vi.fn(() => mockProvider) };
});

const mockGenerateText = vi.fn();
const mockStreamText = vi.fn();
vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return {
		...actual,
		generateText: (...args: unknown[]) => mockGenerateText(...args),
		streamText: (...args: unknown[]) => mockStreamText(...args),
	};
});

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
	for (const item of items) {
		yield item;
	}
}

function mockStreamResult(overrides: {
	textChunks?: string[];
	fullStreamParts?: Record<string, unknown>[];
	text?: string;
	toolCalls?: unknown[];
	toolResults?: unknown[];
	totalUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
	finishReason?: string;
}) {
	const tc = overrides.toolCalls ?? [];
	const tr = overrides.toolResults ?? [];
	return {
		textStream: toAsyncIterable(overrides.textChunks ?? []),
		fullStream: toAsyncIterable(overrides.fullStreamParts ?? []),
		text: Promise.resolve(overrides.text ?? ""),
		toolCalls: Promise.resolve(tc),
		toolResults: Promise.resolve(tr),
		steps: Promise.resolve([{ toolCalls: tc, toolResults: tr }]),
		totalUsage: Promise.resolve(
			overrides.totalUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		),
		finishReason: Promise.resolve(overrides.finishReason ?? "stop"),
		toTextStreamResponse: () => new Response(""),
	};
}

const providerConfig = {
	anthropic: { apiKey: "sk-ant-test" },
	openai: { apiKey: "sk-openai-test" },
	openrouter: { apiKey: "sk-or-test" },
};

function createProvider() {
	return new VercelLLMProvider({
		providerConfig,
		defaultModel: "anthropic/claude-sonnet-4-5-20250929",
	});
}

describe("VercelLLMProvider.generate", () => {
	it("returns text for a simple response", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "Hello, world!",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			finishReason: "stop",
		});

		const provider = createProvider();
		const result = await provider.generate({
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(result.text).toBe("Hello, world!");
		expect(result.toolCalls).toEqual([]);
		expect(result.toolResults).toEqual([]);
		expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
		expect(result.finishReason).toBe("stop");
	});

	it("maps tool calls from AI SDK format to our format", async () => {
		const tc = [{ toolCallId: "call-1", toolName: "shell", input: { command: "ls" } }];
		const tr = [{ toolCallId: "call-1", toolName: "shell", output: "file1.txt\nfile2.txt" }];
		mockGenerateText.mockResolvedValueOnce({
			text: "",
			toolCalls: tc,
			toolResults: tr,
			steps: [{ toolCalls: tc, toolResults: tr }],
			usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
			totalUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
			finishReason: "tool-calls",
		});

		const provider = createProvider();
		const result = await provider.generate({
			messages: [{ role: "user", content: "List files" }],
		});

		expect(result.toolCalls).toEqual([
			{ id: "call-1", name: "shell", arguments: { command: "ls" } },
		]);
		expect(result.toolResults).toEqual([
			{ toolCallId: "call-1", toolName: "shell", content: "file1.txt\nfile2.txt" },
		]);
		expect(result.finishReason).toBe("tool-calls");
	});

	it("returns error as content on LLM failure", async () => {
		mockGenerateText.mockRejectedValueOnce(new Error("Rate limit exceeded"));

		const provider = createProvider();
		const result = await provider.generate({
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(result.text).toBe("[LLM Error] Rate limit exceeded");
		expect(result.toolCalls).toEqual([]);
		expect(result.toolResults).toEqual([]);
		expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
		expect(result.finishReason).toBe("error");
	});

	it("passes temperature and maxOutputTokens to generateText", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "ok",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});

		const provider = createProvider();
		await provider.generate({
			messages: [{ role: "user", content: "Hi" }],
			temperature: 0.5,
			maxTokens: 1024,
		});

		expect(mockGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({
				temperature: 0.5,
				maxOutputTokens: 1024,
			}),
		);
	});

	it("uses default model when none specified in options", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "ok",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});

		const provider = createProvider();
		await provider.generate({
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(mockGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ model: expect.anything() }),
		);
	});

	it("maps maxSteps to stopWhen with stepCountIs", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "ok",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});

		const provider = createProvider();
		await provider.generate({
			messages: [{ role: "user", content: "Hi" }],
			maxSteps: 5,
		});

		expect(mockGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ stopWhen: expect.anything() }),
		);
	});

	it("omits stopWhen when maxSteps is not set", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "ok",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});

		const provider = createProvider();
		await provider.generate({
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ stopWhen: undefined }));
	});

	it("handles missing usage fields gracefully", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "ok",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: {},
			totalUsage: {},
			finishReason: "stop",
		});

		const provider = createProvider();
		const result = await provider.generate({
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
	});
});

describe("VercelLLMProvider prompt caching", () => {
	function lastGenerateCall() {
		const calls = mockGenerateText.mock.calls;
		return calls[calls.length - 1]?.[0];
	}

	it("adds Anthropic cache control to system messages for Anthropic models", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "ok",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});

		const provider = createProvider();
		await provider.generate({
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hi" },
			],
		});

		const callArgs = lastGenerateCall();
		const systemMsg = callArgs?.messages?.[0];
		expect(systemMsg?.providerOptions?.anthropic?.cacheControl).toEqual({ type: "ephemeral" });
	});

	it("does not add cache control for non-Anthropic models", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "ok",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});

		const provider = new VercelLLMProvider({
			providerConfig,
			defaultModel: "openai/gpt-4o",
		});
		await provider.generate({
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hi" },
			],
		});

		const callArgs = lastGenerateCall();
		const systemMsg = callArgs?.messages?.[0];
		expect(systemMsg?.providerOptions).toBeUndefined();
	});

	it("does not add cache control to non-system messages", async () => {
		mockGenerateText.mockResolvedValueOnce({
			text: "ok",
			toolCalls: [],
			toolResults: [],
			steps: [{ toolCalls: [], toolResults: [] }],
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});

		const provider = createProvider();
		await provider.generate({
			messages: [
				{ role: "system", content: "System prompt" },
				{ role: "user", content: "Hi" },
			],
		});

		const callArgs = lastGenerateCall();
		const userMsg = callArgs?.messages?.[1];
		expect(userMsg?.providerOptions).toBeUndefined();
	});
});

describe("VercelLLMProvider.stream", () => {
	it("streams text deltas via textStream", async () => {
		mockStreamText.mockReturnValueOnce(mockStreamResult({ textChunks: ["Hello", ", ", "world!"] }));

		const provider = createProvider();
		const stream = await provider.stream({
			messages: [{ role: "user", content: "Hi" }],
		});

		const chunks: string[] = [];
		for await (const chunk of stream.textStream) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual(["Hello", ", ", "world!"]);
	});

	it("maps fullStream events to our StreamPart types", async () => {
		mockStreamText.mockReturnValueOnce(
			mockStreamResult({
				fullStreamParts: [
					{ type: "text-delta", id: "1", text: "Hello" },
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "shell",
						input: { command: "ls" },
					},
					{
						type: "tool-result",
						toolCallId: "call-1",
						toolName: "shell",
						output: "file1.txt",
					},
					{
						type: "finish",
						finishReason: "stop",
						totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					},
				],
			}),
		);

		const provider = createProvider();
		const stream = await provider.stream({
			messages: [{ role: "user", content: "Hi" }],
		});

		const parts: StreamPart[] = [];
		for await (const part of stream.fullStream) {
			parts.push(part);
		}

		expect(parts).toEqual([
			{ type: "text-delta", textDelta: "Hello" },
			{
				type: "tool-call",
				toolCall: { id: "call-1", name: "shell", arguments: { command: "ls" } },
			},
			{
				type: "tool-result",
				toolResult: { toolCallId: "call-1", toolName: "shell", content: "file1.txt" },
			},
			{
				type: "finish",
				finishReason: "stop",
				usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
			},
		]);
	});

	it("emits error StreamPart on stream error event", async () => {
		mockStreamText.mockReturnValueOnce(
			mockStreamResult({
				fullStreamParts: [
					{ type: "text-delta", id: "1", text: "Hello" },
					{ type: "error", error: new Error("Connection lost") },
				],
			}),
		);

		const provider = createProvider();
		const stream = await provider.stream({
			messages: [{ role: "user", content: "Hi" }],
		});

		const parts: StreamPart[] = [];
		for await (const part of stream.fullStream) {
			parts.push(part);
		}

		expect(parts).toEqual([
			{ type: "text-delta", textDelta: "Hello" },
			{ type: "error", error: "Connection lost" },
		]);
	});

	it("result promise resolves to aggregated GenerateResult", async () => {
		mockStreamText.mockReturnValueOnce(
			mockStreamResult({
				text: "Hello",
				toolCalls: [{ toolCallId: "c1", toolName: "t1", input: { a: 1 } }],
				toolResults: [{ toolCallId: "c1", toolName: "t1", output: "done" }],
				totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
				finishReason: "stop",
			}),
		);

		const provider = createProvider();
		const stream = await provider.stream({
			messages: [{ role: "user", content: "Hi" }],
		});

		const result = await stream.result;
		expect(result.text).toBe("Hello");
		expect(result.toolCalls).toEqual([{ id: "c1", name: "t1", arguments: { a: 1 } }]);
		expect(result.toolResults).toEqual([{ toolCallId: "c1", toolName: "t1", content: "done" }]);
		expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
		expect(result.finishReason).toBe("stop");
	});

	it("returns error stream result on pre-stream failure", async () => {
		const provider = new VercelLLMProvider({
			providerConfig: {
				anthropic: { apiKey: "" },
				openai: { apiKey: "" },
				openrouter: { apiKey: "" },
			},
			defaultModel: "anthropic/claude-sonnet-4-5-20250929",
		});

		const stream = await provider.stream({
			messages: [{ role: "user", content: "Hi" }],
		});

		const result = await stream.result;
		expect(result.text).toContain("[LLM Error]");
		expect(result.finishReason).toBe("error");

		const parts: StreamPart[] = [];
		for await (const part of stream.fullStream) {
			parts.push(part);
		}
		expect(parts.length).toBeGreaterThan(0);
		expect(parts[0]?.type).toBe("error");
	});
});
