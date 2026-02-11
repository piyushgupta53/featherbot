import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMMessage } from "../provider/types.js";
import type { ExtractionResult } from "./extraction-schema.js";
import { MemoryExtractor, buildExtractionPrompt } from "./extractor.js";
import type { MemoryExtractorOptions } from "./extractor.js";
import type { MemoryStore } from "./types.js";

function createMockProvider() {
	return {
		generate: vi.fn(),
		stream: vi.fn(),
		generateStructured: vi.fn().mockResolvedValue({
			object: {
				skip: true,
				facts: [],
				patterns: [],
				pending: [],
				resolvedPending: [],
				observations: [],
			} satisfies ExtractionResult,
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			finishReason: "stop",
		}),
	};
}

function createMockStore(): MemoryStore {
	return {
		getMemoryContext: vi.fn().mockResolvedValue(""),
		getRecentMemories: vi.fn().mockResolvedValue(""),
		getMemoryFilePath: vi.fn().mockReturnValue("/workspace/memory/MEMORY.md"),
		getDailyNotePath: vi.fn().mockReturnValue("/workspace/memory/today.md"),
		readMemoryFile: vi.fn().mockResolvedValue(""),
		writeMemoryFile: vi.fn().mockResolvedValue(undefined),
		readDailyNote: vi.fn().mockResolvedValue(""),
		writeDailyNote: vi.fn().mockResolvedValue(undefined),
		deleteDailyNote: vi.fn().mockResolvedValue(undefined),
		listDailyNotes: vi.fn().mockResolvedValue([]),
	};
}

function createHistory(): Map<string, LLMMessage[]> {
	const histories = new Map<string, LLMMessage[]>();
	histories.set("telegram:123", [
		{ role: "user", content: "Hello, my name is Alice" },
		{ role: "assistant", content: "Nice to meet you Alice!" },
	]);
	return histories;
}

describe("MemoryExtractor", () => {
	let provider: ReturnType<typeof createMockProvider>;
	let store: MemoryStore;
	let histories: Map<string, LLMMessage[]>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		provider = createMockProvider();
		store = createMockStore();
		histories = createHistory();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function createExtractor(overrides?: Partial<MemoryExtractorOptions>) {
		const opts: MemoryExtractorOptions = {
			provider,
			memoryStore: store,
			getHistory: (key) => histories.get(key) ?? [],
			idleMs: 5000,
			...overrides,
		};
		return new MemoryExtractor(opts);
	}

	it("fires generateStructured after idleMs", async () => {
		const extractor = createExtractor();

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		expect(provider.generateStructured).toHaveBeenCalledTimes(1);
		const call = provider.generateStructured.mock.calls[0]?.[0];
		expect(call.schema).toBeDefined();
		expect(call.schemaName).toBe("ExtractionResult");
	});

	it("passes conversation history as messages", async () => {
		const extractor = createExtractor();

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		const call = provider.generateStructured.mock.calls[0]?.[0];
		const messages = call.messages as LLMMessage[];
		// First message is system prompt, then the conversation
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]?.content).toBe("Hello, my name is Alice");
		expect(messages[2]?.content).toBe("Nice to meet you Alice!");
	});

	it("resets timer on new message (debounce)", async () => {
		const extractor = createExtractor();

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(3000);
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(3000);

		expect(provider.generateStructured).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2000);
		expect(provider.generateStructured).toHaveBeenCalledTimes(1);
	});

	it("independent timers per session", async () => {
		histories.set("telegram:456", [
			{ role: "user", content: "Hi there" },
			{ role: "assistant", content: "Hello!" },
		]);
		const extractor = createExtractor();

		extractor.scheduleExtraction("telegram:123");
		extractor.scheduleExtraction("telegram:456");

		await vi.advanceTimersByTimeAsync(5000);
		expect(provider.generateStructured).toHaveBeenCalledTimes(2);
	});

	it("enabled: false is a no-op", async () => {
		const extractor = createExtractor({ enabled: false });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(10000);

		expect(provider.generateStructured).not.toHaveBeenCalled();
	});

	it("skips concurrent extraction for same session", async () => {
		let resolveFirst: (() => void) | undefined;
		const firstPromise = new Promise((resolve) => {
			resolveFirst = () =>
				resolve({
					object: {
						skip: true,
						facts: [],
						patterns: [],
						pending: [],
						resolvedPending: [],
						observations: [],
					},
					usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
					finishReason: "stop",
				});
		});
		provider.generateStructured.mockReturnValueOnce(firstPromise);

		const extractor = createExtractor({ idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		expect(provider.generateStructured).toHaveBeenCalledTimes(1);

		// Schedule again while first is running
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		// Should skip because first extraction is still running
		expect(provider.generateStructured).toHaveBeenCalledTimes(1);

		// Resolve first, then new trigger should work
		resolveFirst?.();
		await vi.advanceTimersByTimeAsync(0);
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		expect(provider.generateStructured).toHaveBeenCalledTimes(2);
	});

	it("writes MEMORY.md deterministically on extraction", async () => {
		provider.generateStructured.mockResolvedValueOnce({
			object: {
				skip: false,
				facts: ["User name is Alice"],
				patterns: [],
				pending: [],
				resolvedPending: [],
				observations: [],
			} satisfies ExtractionResult,
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			finishReason: "stop",
		});

		const extractor = createExtractor();

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		expect(store.writeMemoryFile).toHaveBeenCalledTimes(1);
		const written = (store.writeMemoryFile as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as string;
		expect(written).toContain("- User name is Alice");
	});

	it("writes daily note when observations are present", async () => {
		provider.generateStructured.mockResolvedValueOnce({
			object: {
				skip: false,
				facts: [],
				patterns: [],
				pending: [],
				resolvedPending: [],
				observations: [{ text: "User decided on TypeScript", priority: "red" }],
			} satisfies ExtractionResult,
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			finishReason: "stop",
		});

		const extractor = createExtractor();

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		expect(store.writeDailyNote).toHaveBeenCalledTimes(1);
		const written = (store.writeDailyNote as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
		expect(written).toContain("🔴 User decided on TypeScript");
		expect(written).toContain("telegram:123");
	});

	it("skips extraction when no messages in history", async () => {
		histories.set("telegram:empty", []);
		const extractor = createExtractor();

		extractor.scheduleExtraction("telegram:empty");
		await vi.advanceTimersByTimeAsync(5000);

		expect(provider.generateStructured).not.toHaveBeenCalled();
		expect(console.log).toHaveBeenCalledWith(
			"[memory] extraction skipped for telegram:empty (no messages)",
		);
	});

	it("logs skip when LLM returns skip with no facts/observations", async () => {
		const extractor = createExtractor();

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		expect(console.log).toHaveBeenCalledWith(
			"[memory] extraction skipped for telegram:123 (nothing new)",
		);
		// Should NOT have written anything
		expect(store.writeMemoryFile).not.toHaveBeenCalled();
	});

	it("swallows generateStructured errors and logs them", async () => {
		const error = new Error("LLM unavailable");
		provider.generateStructured.mockRejectedValueOnce(error);

		const extractor = createExtractor({ idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);

		expect(console.error).toHaveBeenCalledWith(
			"[memory] extraction failed for telegram:123:",
			error,
		);

		// Should still work after error
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		expect(provider.generateStructured).toHaveBeenCalledTimes(2);
	});

		it("triggers compaction when MEMORY.md exceeds threshold", async () => {
			const largeContent = "x".repeat(5000);
			(store.readMemoryFile as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce("") // first read for extraction
				.mockResolvedValueOnce("") // second read inside serialized merge
				.mockResolvedValueOnce(largeContent); // third read after write to check size

		provider.generateStructured
			.mockResolvedValueOnce({
				object: {
					skip: false,
					facts: ["New fact"],
					patterns: [],
					pending: [],
					resolvedPending: [],
					observations: [],
				} satisfies ExtractionResult,
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				finishReason: "stop",
			})
			.mockResolvedValueOnce({
				object: {
					facts: ["Compacted fact"],
					patterns: [],
					pending: [],
				},
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				finishReason: "stop",
			});

		const extractor = createExtractor({ compactionThreshold: 4000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		// Should have called generateStructured twice: extraction + compaction
		expect(provider.generateStructured).toHaveBeenCalledTimes(2);
		expect(console.log).toHaveBeenCalledWith("[memory] compaction complete");
	});

		it("max-age forces extraction even without idle timeout", async () => {
			const extractor = createExtractor({ idleMs: 60000, maxAgeMs: 5000 });

		// First extraction to set lastExtraction timestamp
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(60000);
		expect(provider.generateStructured).toHaveBeenCalledTimes(1);

		// Advance time beyond maxAgeMs, then schedule
		await vi.advanceTimersByTimeAsync(5000);
		extractor.scheduleExtraction("telegram:123");

		// Should fire immediately due to max-age, not wait for idle
			await vi.advanceTimersByTimeAsync(0);
			expect(provider.generateStructured).toHaveBeenCalledTimes(2);
		});

		it("max-age also forces extraction before first successful extraction", async () => {
			const extractor = createExtractor({ idleMs: 60000, maxAgeMs: 5000 });

			extractor.scheduleExtraction("telegram:123");
			await vi.advanceTimersByTimeAsync(5001);
			// Re-scheduling after max-age should trigger immediate extraction.
			extractor.scheduleExtraction("telegram:123");
			await vi.advanceTimersByTimeAsync(0);

			expect(provider.generateStructured).toHaveBeenCalledTimes(1);
		});

	it("dispose() force-extracts pending sessions", async () => {
		const extractor = createExtractor({ idleMs: 60000 });

		extractor.scheduleExtraction("telegram:123");
		// Timer hasn't fired yet

		await extractor.dispose();

		expect(provider.generateStructured).toHaveBeenCalledTimes(1);
	});

	it("dispose() clears timers even when no pending extractions", async () => {
		const extractor = createExtractor({ enabled: false });
		// No timers set because disabled
		await expect(extractor.dispose()).resolves.toBeUndefined();
	});
});

describe("buildExtractionPrompt", () => {
	it("includes current memory content", () => {
		const prompt = buildExtractionPrompt("## Facts\n- User name is Bob");
		expect(prompt).toContain("User name is Bob");
	});

	it("shows (empty) when no current memory", () => {
		const prompt = buildExtractionPrompt("");
		expect(prompt).toContain("(empty)");
	});

	it("describes all extraction fields", () => {
		const prompt = buildExtractionPrompt("");
		expect(prompt).toContain("facts");
		expect(prompt).toContain("patterns");
		expect(prompt).toContain("pending");
		expect(prompt).toContain("resolvedPending");
		expect(prompt).toContain("observations");
	});
});
