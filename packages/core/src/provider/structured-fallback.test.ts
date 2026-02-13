import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CompactionResultSchema, ExtractionResultSchema } from "../memory/extraction-schema.js";
import {
	extractJsonFromText,
	generateStructuredWithFallback,
	zodSchemaToJsonExample,
} from "./structured-fallback.js";
import type { GenerateResult, GenerateStructuredResult, LLMProvider } from "./types.js";

// ---------------------------------------------------------------------------
// extractJsonFromText
// ---------------------------------------------------------------------------
describe("extractJsonFromText", () => {
	it("parses raw JSON directly", () => {
		const result = extractJsonFromText('{"a":1}');
		expect(result).toEqual({ a: 1 });
	});

	it("parses JSON with leading/trailing whitespace", () => {
		const result = extractJsonFromText('  \n {"a":1} \n ');
		expect(result).toEqual({ a: 1 });
	});

	it("extracts JSON from markdown fences", () => {
		const text = 'Here is the result:\n```json\n{"a":1}\n```\nDone!';
		expect(extractJsonFromText(text)).toEqual({ a: 1 });
	});

	it("extracts JSON from fences without json label", () => {
		const text = '```\n{"key":"value"}\n```';
		expect(extractJsonFromText(text)).toEqual({ key: "value" });
	});

	it("extracts JSON with preamble and postamble", () => {
		const text = 'Sure! Here is the JSON:\n{"facts":["likes tea"]}\nHope that helps!';
		expect(extractJsonFromText(text)).toEqual({ facts: ["likes tea"] });
	});

	it("handles nested objects via brace counter", () => {
		const text = 'Output: {"a":{"b":{"c":1}},"d":[1,2]}. Done.';
		expect(extractJsonFromText(text)).toEqual({ a: { b: { c: 1 } }, d: [1, 2] });
	});

	it("handles strings with braces inside", () => {
		const text = '{"msg":"hello {world}"}';
		expect(extractJsonFromText(text)).toEqual({ msg: "hello {world}" });
	});

	it("handles escaped quotes in strings", () => {
		const text = '{"msg":"say \\"hi\\""}';
		expect(extractJsonFromText(text)).toEqual({ msg: 'say "hi"' });
	});

	it("throws when no JSON is present", () => {
		expect(() => extractJsonFromText("No json here")).toThrow("No valid JSON found");
	});

	it("throws on empty string", () => {
		expect(() => extractJsonFromText("")).toThrow("No valid JSON found");
	});
});

// ---------------------------------------------------------------------------
// zodSchemaToJsonExample
// ---------------------------------------------------------------------------
describe("zodSchemaToJsonExample", () => {
	it("generates example for ExtractionResultSchema", () => {
		const example = zodSchemaToJsonExample(ExtractionResultSchema);
		const parsed = JSON.parse(example);
		expect(parsed).toHaveProperty("skip", "<boolean>");
		expect(parsed).toHaveProperty("facts");
		expect(Array.isArray(parsed.facts)).toBe(true);
		expect(parsed.observations[0]).toHaveProperty("text", "<string>");
		expect(parsed.observations[0]).toHaveProperty("priority", "<red | yellow | green>");
	});

	it("generates example for CompactionResultSchema", () => {
		const example = zodSchemaToJsonExample(CompactionResultSchema);
		const parsed = JSON.parse(example);
		expect(parsed).toHaveProperty("facts");
		expect(parsed).toHaveProperty("patterns");
		expect(parsed).toHaveProperty("pending");
	});

	it("handles simple object with enum", () => {
		const schema = z.object({
			name: z.string(),
			status: z.enum(["active", "inactive"]),
			count: z.number(),
			flag: z.boolean(),
		});
		const parsed = JSON.parse(zodSchemaToJsonExample(schema));
		expect(parsed).toEqual({
			name: "<string>",
			status: "<active | inactive>",
			count: "<number>",
			flag: "<boolean>",
		});
	});

	it("handles optional fields", () => {
		const schema = z.object({
			required: z.string(),
			optional: z.string().optional(),
		});
		const parsed = JSON.parse(zodSchemaToJsonExample(schema));
		expect(parsed).toEqual({
			required: "<string>",
			optional: "<string>",
		});
	});
});

// ---------------------------------------------------------------------------
// generateStructuredWithFallback
// ---------------------------------------------------------------------------
describe("generateStructuredWithFallback", () => {
	const schema = z.object({
		facts: z.array(z.string()),
		count: z.number(),
	});

	function makeMockProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
		return {
			generate: vi.fn(),
			stream: vi.fn(),
			generateStructured: vi.fn(),
			...overrides,
		} as unknown as LLMProvider;
	}

	it("returns result when generateStructured succeeds", async () => {
		const expected: GenerateStructuredResult<{ facts: string[]; count: number }> = {
			object: { facts: ["a"], count: 1 },
			usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
			finishReason: "stop",
		};
		const provider = makeMockProvider({
			generateStructured: vi.fn().mockResolvedValue(expected),
		});

		const result = await generateStructuredWithFallback({
			provider,
			messages: [{ role: "user", content: "test" }],
			schema,
		});

		expect(result).toBe(expected);
		expect(provider.generate).not.toHaveBeenCalled();
	});

	it("falls back to text generation on structured failure", async () => {
		const textResult: GenerateResult = {
			text: '{"facts":["fallback"],"count":42}',
			toolCalls: [],
			toolResults: [],
			usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
			finishReason: "stop",
		};
		const provider = makeMockProvider({
			generateStructured: vi.fn().mockRejectedValue(new Error("NoObjectGeneratedError")),
			generate: vi.fn().mockResolvedValue(textResult),
		});

		const result = await generateStructuredWithFallback({
			provider,
			messages: [{ role: "user", content: "test" }],
			schema,
		});

		expect(result.object).toEqual({ facts: ["fallback"], count: 42 });
		expect(result.usage).toEqual(textResult.usage);
		expect(provider.generate).toHaveBeenCalledTimes(1);
	});

	it("handles fallback with fenced JSON response", async () => {
		const textResult: GenerateResult = {
			text: 'Here is the result:\n```json\n{"facts":["fenced"],"count":7}\n```\n',
			toolCalls: [],
			toolResults: [],
			usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
			finishReason: "stop",
		};
		const provider = makeMockProvider({
			generateStructured: vi.fn().mockRejectedValue(new Error("unsupported")),
			generate: vi.fn().mockResolvedValue(textResult),
		});

		const result = await generateStructuredWithFallback({
			provider,
			messages: [{ role: "user", content: "test" }],
			schema,
		});

		expect(result.object).toEqual({ facts: ["fenced"], count: 7 });
	});

	it("throws when both structured and fallback fail", async () => {
		const provider = makeMockProvider({
			generateStructured: vi.fn().mockRejectedValue(new Error("primary fail")),
			generate: vi.fn().mockResolvedValue({
				text: "I cannot produce JSON",
				toolCalls: [],
				toolResults: [],
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				finishReason: "stop",
			}),
		});

		await expect(
			generateStructuredWithFallback({
				provider,
				messages: [{ role: "user", content: "test" }],
				schema,
			}),
		).rejects.toThrow();
	});

	it("validates fallback response against schema", async () => {
		const textResult: GenerateResult = {
			text: '{"facts":"not-an-array","count":"not-a-number"}',
			toolCalls: [],
			toolResults: [],
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			finishReason: "stop",
		};
		const provider = makeMockProvider({
			generateStructured: vi.fn().mockRejectedValue(new Error("fail")),
			generate: vi.fn().mockResolvedValue(textResult),
		});

		await expect(
			generateStructuredWithFallback({
				provider,
				messages: [{ role: "user", content: "test" }],
				schema,
			}),
		).rejects.toThrow();
	});

	it("appends schema instruction as last user message in fallback", async () => {
		const textResult: GenerateResult = {
			text: '{"facts":[],"count":0}',
			toolCalls: [],
			toolResults: [],
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			finishReason: "stop",
		};
		const generateFn = vi.fn().mockResolvedValue(textResult);
		const provider = makeMockProvider({
			generateStructured: vi.fn().mockRejectedValue(new Error("fail")),
			generate: generateFn,
		});

		await generateStructuredWithFallback({
			provider,
			messages: [
				{ role: "system", content: "You are helpful" },
				{ role: "user", content: "extract stuff" },
			],
			schema,
		});

		const callArgs = generateFn.mock.calls[0]?.[0];
		expect(callArgs.messages).toHaveLength(3);
		expect(callArgs.messages[2].role).toBe("user");
		expect(callArgs.messages[2].content).toContain("valid JSON object");
	});
});
