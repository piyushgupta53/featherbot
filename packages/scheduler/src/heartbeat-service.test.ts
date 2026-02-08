import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeartbeatService } from "./heartbeat-service.js";

describe("HeartbeatService", () => {
	let tmpDir: string;
	let filePath: string;

	beforeEach(() => {
		vi.useFakeTimers();
		tmpDir = mkdtempSync(join(tmpdir(), "heartbeat-"));
		filePath = join(tmpDir, "HEARTBEAT.md");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires onTick at configured interval with file content", async () => {
		writeFileSync(filePath, "Check email");
		const onTick = vi.fn().mockResolvedValue(undefined);
		const service = new HeartbeatService({
			intervalMs: 5000,
			heartbeatFilePath: filePath,
			onTick,
		});

		service.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).toHaveBeenCalledWith("Check email");
		service.stop();
	});

	it("does NOT fire immediately on start", async () => {
		writeFileSync(filePath, "Some content");
		const onTick = vi.fn().mockResolvedValue(undefined);
		const service = new HeartbeatService({
			intervalMs: 5000,
			heartbeatFilePath: filePath,
			onTick,
		});

		service.start();
		expect(onTick).not.toHaveBeenCalled();
		service.stop();
	});

	it("skips when file does not exist", async () => {
		const onTick = vi.fn().mockResolvedValue(undefined);
		const service = new HeartbeatService({
			intervalMs: 5000,
			heartbeatFilePath: join(tmpDir, "missing.md"),
			onTick,
		});

		service.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).not.toHaveBeenCalled();
		service.stop();
	});

	it("skips when file is empty", async () => {
		writeFileSync(filePath, "");
		const onTick = vi.fn().mockResolvedValue(undefined);
		const service = new HeartbeatService({
			intervalMs: 5000,
			heartbeatFilePath: filePath,
			onTick,
		});

		service.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).not.toHaveBeenCalled();
		service.stop();
	});

	it("skips when file is whitespace-only", async () => {
		writeFileSync(filePath, "   \n  \t  \n  ");
		const onTick = vi.fn().mockResolvedValue(undefined);
		const service = new HeartbeatService({
			intervalMs: 5000,
			heartbeatFilePath: filePath,
			onTick,
		});

		service.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).not.toHaveBeenCalled();
		service.stop();
	});

	it("skips when previous onTick is still running (busy flag)", async () => {
		writeFileSync(filePath, "Task content");
		let resolveFirst: (() => void) | undefined;
		const firstPromise = new Promise<void>((r) => {
			resolveFirst = r;
		});
		const onTick = vi.fn().mockReturnValueOnce(firstPromise).mockResolvedValue(undefined);
		const service = new HeartbeatService({
			intervalMs: 5000,
			heartbeatFilePath: filePath,
			onTick,
		});

		service.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).toHaveBeenCalledTimes(1);

		// Second tick while first is still running
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).toHaveBeenCalledTimes(1);

		// Resolve first, then third tick should fire
		resolveFirst?.();
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).toHaveBeenCalledTimes(2);
		service.stop();
	});

	it("catches onTick errors and continues timer", async () => {
		writeFileSync(filePath, "Task content");
		const onTick = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
		const service = new HeartbeatService({
			intervalMs: 5000,
			heartbeatFilePath: filePath,
			onTick,
		});

		service.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).toHaveBeenCalledTimes(1);

		// Timer should still fire after error
		await vi.advanceTimersByTimeAsync(5000);
		expect(onTick).toHaveBeenCalledTimes(2);
		service.stop();
	});

	it("stop() clears timer with no more ticks", async () => {
		writeFileSync(filePath, "Task content");
		const onTick = vi.fn().mockResolvedValue(undefined);
		const service = new HeartbeatService({
			intervalMs: 5000,
			heartbeatFilePath: filePath,
			onTick,
		});

		service.start();
		service.stop();
		await vi.advanceTimersByTimeAsync(10000);
		expect(onTick).not.toHaveBeenCalled();
	});
});
