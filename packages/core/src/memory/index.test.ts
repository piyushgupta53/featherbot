import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "./index.js";

describe("createMemoryStore", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await realpath(await mkdtemp(join(tmpdir(), "memory-int-")));
		await mkdir(join(tempDir, "memory"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	it("returns a MemoryStore with all expected methods", () => {
		const store = createMemoryStore(tempDir);
		expect(typeof store.getMemoryContext).toBe("function");
		expect(typeof store.getRecentMemories).toBe("function");
		expect(typeof store.getMemoryFilePath).toBe("function");
		expect(typeof store.getDailyNotePath).toBe("function");
	});

	it("works end-to-end: write files, read context", async () => {
		const store = createMemoryStore(tempDir);
		await writeFile(store.getMemoryFilePath(), "I am a bot");
		const today = new Date().toISOString().slice(0, 10);
		await writeFile(store.getDailyNotePath(), "Did stuff today");

		const ctx = await store.getMemoryContext();
		expect(ctx).toContain("## Long-term Memory");
		expect(ctx).toContain("I am a bot");
		expect(ctx).toContain(`## Today's Notes (${today})`);
		expect(ctx).toContain("Did stuff today");
	});
});
