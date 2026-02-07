import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileMemoryStore } from "./file-store.js";

describe("FileMemoryStore", () => {
	let tempDir: string;
	let store: FileMemoryStore;

	beforeEach(async () => {
		tempDir = await realpath(await mkdtemp(join(tmpdir(), "memory-test-")));
		await mkdir(join(tempDir, "memory"), { recursive: true });
		store = new FileMemoryStore(tempDir);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	describe("getMemoryFilePath", () => {
		it("returns path to MEMORY.md in memory directory", () => {
			expect(store.getMemoryFilePath()).toBe(join(tempDir, "memory", "MEMORY.md"));
		});
	});

	describe("getDailyNotePath", () => {
		it("returns path for a specific date", () => {
			const date = new Date("2026-02-07T12:00:00Z");
			expect(store.getDailyNotePath(date)).toBe(join(tempDir, "memory", "2026-02-07.md"));
		});

		it("defaults to today when no date given", () => {
			const today = new Date().toISOString().slice(0, 10);
			expect(store.getDailyNotePath()).toBe(join(tempDir, "memory", `${today}.md`));
		});
	});

	describe("getMemoryContext", () => {
		it("returns both sections when both files exist", async () => {
			await writeFile(join(tempDir, "memory", "MEMORY.md"), "long-term stuff");
			const today = new Date().toISOString().slice(0, 10);
			await writeFile(join(tempDir, "memory", `${today}.md`), "daily stuff");

			const result = await store.getMemoryContext();
			expect(result).toBe(
				`## Long-term Memory\nlong-term stuff\n\n## Today's Notes (${today})\ndaily stuff`,
			);
		});

		it("returns only memory section when daily note is missing", async () => {
			await writeFile(join(tempDir, "memory", "MEMORY.md"), "long-term stuff");

			const result = await store.getMemoryContext();
			expect(result).toBe("## Long-term Memory\nlong-term stuff");
		});

		it("returns only daily section when MEMORY.md is missing", async () => {
			const today = new Date().toISOString().slice(0, 10);
			await writeFile(join(tempDir, "memory", `${today}.md`), "daily stuff");

			const result = await store.getMemoryContext();
			expect(result).toBe(`## Today's Notes (${today})\ndaily stuff`);
		});

		it("returns empty string when both files are missing", async () => {
			const result = await store.getMemoryContext();
			expect(result).toBe("");
		});

		it("omits sections with whitespace-only content", async () => {
			await writeFile(join(tempDir, "memory", "MEMORY.md"), "   \n  ");
			const result = await store.getMemoryContext();
			expect(result).toBe("");
		});
	});

	describe("getRecentMemories", () => {
		function dateStr(daysAgo: number): string {
			const d = new Date();
			d.setDate(d.getDate() - daysAgo);
			return d.toISOString().slice(0, 10);
		}

		it("returns multiple days of notes", async () => {
			await writeFile(join(tempDir, "memory", `${dateStr(0)}.md`), "today");
			await writeFile(join(tempDir, "memory", `${dateStr(1)}.md`), "yesterday");

			const result = await store.getRecentMemories(3);
			expect(result).toBe(`### ${dateStr(0)}\ntoday\n\n### ${dateStr(1)}\nyesterday\n`);
		});

		it("skips days with missing files", async () => {
			await writeFile(join(tempDir, "memory", `${dateStr(0)}.md`), "today");
			// day 1 missing
			await writeFile(join(tempDir, "memory", `${dateStr(2)}.md`), "two days ago");

			const result = await store.getRecentMemories(3);
			expect(result).toBe(`### ${dateStr(0)}\ntoday\n\n### ${dateStr(2)}\ntwo days ago\n`);
		});

		it("returns empty string when no files exist", async () => {
			const result = await store.getRecentMemories(7);
			expect(result).toBe("");
		});

		it("returns single day when only today exists", async () => {
			await writeFile(join(tempDir, "memory", `${dateStr(0)}.md`), "just today");

			const result = await store.getRecentMemories(1);
			expect(result).toBe(`### ${dateStr(0)}\njust today\n`);
		});

		it("defaults to 7 days", async () => {
			await writeFile(join(tempDir, "memory", `${dateStr(6)}.md`), "six days ago");

			const result = await store.getRecentMemories();
			expect(result).toContain(`### ${dateStr(6)}`);
			expect(result).toContain("six days ago");
		});

		it("skips whitespace-only files", async () => {
			await writeFile(join(tempDir, "memory", `${dateStr(0)}.md`), "  \n  ");
			const result = await store.getRecentMemories(1);
			expect(result).toBe("");
		});
	});

	describe("readFileSafe", () => {
		it("reads an existing file", async () => {
			await writeFile(join(tempDir, "memory", "MEMORY.md"), "hello world");
			const content = await store.readFileSafe(join(tempDir, "memory", "MEMORY.md"));
			expect(content).toBe("hello world");
		});

		it("returns empty string for missing file", async () => {
			const content = await store.readFileSafe(join(tempDir, "memory", "nonexistent.md"));
			expect(content).toBe("");
		});

		it("throws on non-ENOENT errors", async () => {
			await expect(store.readFileSafe(tempDir)).rejects.toThrow();
		});
	});
});
