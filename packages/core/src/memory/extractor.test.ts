import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryExtractor, buildExtractionPrompt } from "./extractor.js";

describe("MemoryExtractor", () => {
	let agentLoop: { processDirect: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		agentLoop = {
			processDirect: vi.fn().mockResolvedValue({ text: "SKIP", toolResults: [] }),
		};
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("fires processDirect after idleMs with extraction prompt and sessionKey", async () => {
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 5000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		expect(agentLoop.processDirect).toHaveBeenCalledTimes(1);
		const call = agentLoop.processDirect.mock.calls[0] as [
			string,
			{ sessionKey: string; skipHistory: boolean },
		];
		expect(call[0]).toContain("observation log");
		expect(call[1].sessionKey).toBe("telegram:123");
	});

	it("passes skipHistory: true to processDirect", async () => {
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 5000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		const call = agentLoop.processDirect.mock.calls[0] as [
			string,
			{ sessionKey: string; skipHistory: boolean },
		];
		expect(call[1].skipHistory).toBe(true);
	});

	it("injects sessionKey and date into extraction prompt", async () => {
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 5000 });

		extractor.scheduleExtraction("telegram:8525075853");
		await vi.advanceTimersByTimeAsync(5000);

		const call = agentLoop.processDirect.mock.calls[0] as [string, unknown];
		const prompt = call[0];
		expect(prompt).toContain("telegram:8525075853");
		// Date is injected (YYYY-MM-DD format)
		const today = new Date().toISOString().slice(0, 10);
		expect(prompt).toContain(`memory/${today}.md`);
	});

	it("resets timer on new message (debounce)", async () => {
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 5000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(3000);
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(3000);

		expect(agentLoop.processDirect).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2000);
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(1);
	});

	it("independent timers per session", async () => {
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 5000 });

		extractor.scheduleExtraction("telegram:123");
		extractor.scheduleExtraction("telegram:456");

		await vi.advanceTimersByTimeAsync(5000);
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(2);

		const calls = agentLoop.processDirect.mock.calls as Array<[string, { sessionKey: string }]>;
		const keys = calls.map((c) => c[1].sessionKey);
		expect(keys).toContain("telegram:123");
		expect(keys).toContain("telegram:456");
	});

	it("enabled: false is a no-op", async () => {
		const extractor = new MemoryExtractor({
			agentLoop,
			idleMs: 5000,
			enabled: false,
		});

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(10000);

		expect(agentLoop.processDirect).not.toHaveBeenCalled();
	});

	it("skips concurrent extraction for same session", async () => {
		let resolveFirst: (() => void) | undefined;
		const firstPromise = new Promise<{ text: string; toolResults: unknown[] }>((r) => {
			resolveFirst = () => r({ text: "SKIP", toolResults: [] });
		});
		agentLoop.processDirect.mockReturnValueOnce(firstPromise);

		const extractor = new MemoryExtractor({ agentLoop, idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(1);

		// Schedule again while first is running
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		// Should skip because first extraction is still running
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(1);

		// Resolve first, then new trigger should work
		resolveFirst?.();
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(2);
	});

	it("dispose() clears pending timers", async () => {
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 5000 });

		extractor.scheduleExtraction("telegram:123");
		extractor.scheduleExtraction("telegram:456");
		extractor.dispose();

		await vi.advanceTimersByTimeAsync(10000);
		expect(agentLoop.processDirect).not.toHaveBeenCalled();
	});

	it("swallows processDirect errors and logs them", async () => {
		const error = new Error("boom");
		agentLoop.processDirect.mockRejectedValueOnce(error);

		const extractor = new MemoryExtractor({ agentLoop, idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);

		// Should not throw — error is swallowed
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(1);
		expect(console.error).toHaveBeenCalledWith(
			"[memory] extraction failed for telegram:123:",
			error,
		);

		// Should still work after error
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(2);
	});

	it("logs 'skipped' when result is SKIP", async () => {
		agentLoop.processDirect.mockResolvedValue({ text: "SKIP", toolResults: [] });
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);

		expect(console.log).toHaveBeenCalledWith(
			"[memory] extracting observations for telegram:123...",
		);
		expect(console.log).toHaveBeenCalledWith(
			"[memory] extraction skipped for telegram:123 (nothing new)",
		);
	});

	it("logs 'complete' with file write count when toolResults show successful writes", async () => {
		agentLoop.processDirect.mockResolvedValue({
			text: "Wrote observations to daily note",
			toolResults: [
				{ toolName: "read_file", content: "file contents" },
				{ toolName: "write_file", content: "Successfully wrote to memory/2026-02-10.md" },
				{ toolName: "write_file", content: "Successfully wrote to memory/MEMORY.md" },
			],
		});
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);

		expect(console.log).toHaveBeenCalledWith(
			"[memory] extraction complete for telegram:123 (2 file write(s))",
		);
	});

	it("warns when a write tool result starts with 'Error'", async () => {
		agentLoop.processDirect.mockResolvedValue({
			text: "Tried to write",
			toolResults: [{ toolName: "write_file", content: "Error: EACCES permission denied" }],
		});
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);

		expect(console.warn).toHaveBeenCalledWith(
			"[memory] extraction had 1 failed write(s) for telegram:123",
		);
	});

	it("warns when extraction returned text but wrote no files", async () => {
		agentLoop.processDirect.mockResolvedValue({
			text: "Here are the observations I noticed",
			toolResults: [{ toolName: "read_file", content: "some content" }],
		});
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);

		expect(console.warn).toHaveBeenCalledWith(
			"[memory] extraction returned text but wrote no files for telegram:123",
		);
	});

	it("warns when extraction returned text with no tool results", async () => {
		agentLoop.processDirect.mockResolvedValue({
			text: "Nothing important happened",
		});
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);

		expect(console.warn).toHaveBeenCalledWith(
			"[memory] extraction returned text but wrote no files for telegram:123",
		);
	});
});

describe("buildExtractionPrompt", () => {
	it("includes sessionKey in the prompt", () => {
		const prompt = buildExtractionPrompt("telegram:8525075853", "2026-02-10");
		expect(prompt).toContain("telegram:8525075853");
	});

	it("includes date in the prompt", () => {
		const prompt = buildExtractionPrompt("telegram:123", "2026-02-10");
		expect(prompt).toContain("memory/2026-02-10.md");
		expect(prompt).toContain("# 2026-02-10");
	});

	it("instructs to use write_file instead of edit_file for daily notes", () => {
		const prompt = buildExtractionPrompt("telegram:123", "2026-02-10");
		expect(prompt).toContain("write_file");
	});

	it("has a lower SKIP threshold", () => {
		const prompt = buildExtractionPrompt("telegram:123", "2026-02-10");
		expect(prompt).toContain("truly empty");
	});

	it("includes duplicate detection step", () => {
		const prompt = buildExtractionPrompt("telegram:123", "2026-02-10");
		expect(prompt).toContain("Duplicate Detection");
	});
});
