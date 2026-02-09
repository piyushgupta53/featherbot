import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptionConfig } from "../config/schema.js";
import { Transcriber } from "./transcriber.js";

function makeConfig(overrides?: Partial<TranscriptionConfig>): TranscriptionConfig {
	return {
		enabled: true,
		provider: "groq",
		apiKey: "test-key",
		model: "whisper-large-v3-turbo",
		maxDurationSeconds: 120,
		...overrides,
	};
}

describe("Transcriber", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("uses groq endpoint by default", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ text: "hello world" }),
		});
		globalThis.fetch = mockFetch;

		const transcriber = new Transcriber(makeConfig());
		await transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg");

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.groq.com/openai/v1/audio/transcriptions",
			expect.objectContaining({
				method: "POST",
				headers: { Authorization: "Bearer test-key" },
			}),
		);
	});

	it("uses openai endpoint when provider is openai", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ text: "hello" }),
		});
		globalThis.fetch = mockFetch;

		const transcriber = new Transcriber(makeConfig({ provider: "openai" }));
		await transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg");

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.openai.com/v1/audio/transcriptions",
			expect.anything(),
		);
	});

	it("sends multipart form body with file and model", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ text: "transcribed" }),
		});
		globalThis.fetch = mockFetch;

		const transcriber = new Transcriber(makeConfig());
		await transcriber.transcribe(Buffer.from("audio-data"), "voice.ogg", "audio/ogg");

		const call = mockFetch.mock.calls[0];
		const body = call?.[1]?.body as FormData;
		expect(body).toBeInstanceOf(FormData);
		expect(body.get("model")).toBe("whisper-large-v3-turbo");
		expect(body.get("response_format")).toBe("json");

		const file = body.get("file") as Blob;
		expect(file).toBeInstanceOf(Blob);
		expect(file.type).toBe("audio/ogg");
	});

	it("returns transcribed text and duration", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ text: "hello world" }),
		});

		const transcriber = new Transcriber(makeConfig());
		const result = await transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg");

		expect(result.text).toBe("hello world");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("trims whitespace from transcribed text", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ text: "  hello world  \n" }),
		});

		const transcriber = new Transcriber(makeConfig());
		const result = await transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg");

		expect(result.text).toBe("hello world");
	});

	it("throws on HTTP error response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
		});

		const transcriber = new Transcriber(makeConfig());
		await expect(
			transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg"),
		).rejects.toThrow("Transcription API returned 429 Too Many Requests");
	});

	it("throws on network failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

		const transcriber = new Transcriber(makeConfig());
		await expect(
			transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg"),
		).rejects.toThrow("Network error");
	});

	it("returns empty string when text field is missing", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
		});

		const transcriber = new Transcriber(makeConfig());
		const result = await transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg");

		expect(result.text).toBe("");
	});

	it("defaults to whisper-large-v3-turbo for groq when model is empty", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ text: "hello" }),
		});
		globalThis.fetch = mockFetch;

		const transcriber = new Transcriber(makeConfig({ model: "" }));
		await transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg");

		const body = mockFetch.mock.calls[0]?.[1]?.body as FormData;
		expect(body.get("model")).toBe("whisper-large-v3-turbo");
	});

	it("defaults to whisper-1 for openai when model is empty", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ text: "hello" }),
		});
		globalThis.fetch = mockFetch;

		const transcriber = new Transcriber(makeConfig({ provider: "openai", model: "" }));
		await transcriber.transcribe(Buffer.from("audio"), "voice.ogg", "audio/ogg");

		const body = mockFetch.mock.calls[0]?.[1]?.body as FormData;
		expect(body.get("model")).toBe("whisper-1");
	});

	it("throws for unknown provider", () => {
		expect(
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid provider
			() => new Transcriber(makeConfig({ provider: "invalid" as any })),
		).toThrow("Unknown transcription provider: invalid");
	});
});
