import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryExtractor } from "./extractor.js";

describe("MemoryExtractor", () => {
	let agentLoop: { processDirect: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.useFakeTimers();
		agentLoop = {
			processDirect: vi.fn().mockResolvedValue({ text: "SKIP" }),
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires processDirect after idleMs with extraction prompt and sessionKey", async () => {
		const extractor = new MemoryExtractor({ agentLoop, idleMs: 5000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(5000);

		expect(agentLoop.processDirect).toHaveBeenCalledTimes(1);
		const call = agentLoop.processDirect.mock.calls[0] as [string, { sessionKey: string }];
		expect(call[0]).toContain("Extract any user facts");
		expect(call[1].sessionKey).toBe("telegram:123");
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
		const firstPromise = new Promise<{ text: string }>((r) => {
			resolveFirst = () => r({ text: "SKIP" });
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

	it("swallows processDirect errors", async () => {
		agentLoop.processDirect.mockRejectedValueOnce(new Error("boom"));

		const extractor = new MemoryExtractor({ agentLoop, idleMs: 1000 });

		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);

		// Should not throw — error is swallowed
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(1);

		// Should still work after error
		extractor.scheduleExtraction("telegram:123");
		await vi.advanceTimersByTimeAsync(1000);
		expect(agentLoop.processDirect).toHaveBeenCalledTimes(2);
	});
});
