import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanScratchDir } from "./scratch-cleaner.js";

describe("cleanScratchDir", () => {
	let scratchDir: string;

	beforeEach(async () => {
		scratchDir = await mkdtemp(join(tmpdir(), "scratch-cleaner-test-"));
	});

	afterEach(async () => {
		await rm(scratchDir, { recursive: true });
	});

	it("removes files older than maxAgeMs", async () => {
		const oldFile = join(scratchDir, "old.txt");
		writeFileSync(oldFile, "old");
		const pastTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		utimesSync(oldFile, pastTime, pastTime);

		const removed = cleanScratchDir(scratchDir);
		expect(removed).toBe(1);

		const remaining = await readdir(scratchDir);
		expect(remaining).toHaveLength(0);
	});

	it("keeps files newer than maxAgeMs", async () => {
		writeFileSync(join(scratchDir, "recent.txt"), "fresh");

		const removed = cleanScratchDir(scratchDir);
		expect(removed).toBe(0);

		const remaining = await readdir(scratchDir);
		expect(remaining).toHaveLength(1);
	});

	it("removes old directories recursively", async () => {
		const oldDir = join(scratchDir, "old-dir");
		mkdirSync(oldDir);
		writeFileSync(join(oldDir, "file.txt"), "content");
		const pastTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		utimesSync(oldDir, pastTime, pastTime);

		const removed = cleanScratchDir(scratchDir);
		expect(removed).toBe(1);

		const remaining = await readdir(scratchDir);
		expect(remaining).toHaveLength(0);
	});

	it("returns 0 when scratch directory does not exist", () => {
		const removed = cleanScratchDir("/nonexistent-scratch-dir-abc123");
		expect(removed).toBe(0);
	});

	it("supports custom maxAgeMs", async () => {
		writeFileSync(join(scratchDir, "file.txt"), "data");
		const pastTime = new Date(Date.now() - 2000);
		utimesSync(join(scratchDir, "file.txt"), pastTime, pastTime);

		const removed = cleanScratchDir(scratchDir, 1000);
		expect(removed).toBe(1);
	});

	it("keeps files within custom maxAgeMs", async () => {
		writeFileSync(join(scratchDir, "file.txt"), "data");

		const removed = cleanScratchDir(scratchDir, 60000);
		expect(removed).toBe(0);
	});
});
