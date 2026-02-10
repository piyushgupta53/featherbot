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
		function yesterdayStr(): string {
			const d = new Date();
			d.setDate(d.getDate() - 1);
			return d.toISOString().slice(0, 10);
		}

		it("returns both sections when both files exist", async () => {
			await writeFile(join(tempDir, "memory", "MEMORY.md"), "long-term stuff");
			const today = new Date().toISOString().slice(0, 10);
			await writeFile(join(tempDir, "memory", `${today}.md`), "daily stuff");

			const result = await store.getMemoryContext();
			expect(result).toContain("## Long-term Memory\nlong-term stuff");
			expect(result).toContain(`## Today's Notes (${today})\ndaily stuff`);
		});

		it("returns only memory section when daily note is missing", async () => {
			await writeFile(join(tempDir, "memory", "MEMORY.md"), "long-term stuff");

			const result = await store.getMemoryContext();
			expect(result).toContain("## Long-term Memory\nlong-term stuff");
		});

		it("returns only daily section when MEMORY.md is missing", async () => {
			const today = new Date().toISOString().slice(0, 10);
			await writeFile(join(tempDir, "memory", `${today}.md`), "daily stuff");

			const result = await store.getMemoryContext();
			expect(result).toContain(`## Today's Notes (${today})\ndaily stuff`);
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

		it("includes size warning when MEMORY.md exceeds threshold", async () => {
			const largeContent = "x".repeat(9000);
			await writeFile(join(tempDir, "memory", "MEMORY.md"), largeContent);

			const result = await store.getMemoryContext();
			expect(result).toContain("**Warning: MEMORY.md is large");
			expect(result).toContain("consolidate");
		});

		it("does not include size warning when MEMORY.md is small", async () => {
			await writeFile(join(tempDir, "memory", "MEMORY.md"), "small content");

			const result = await store.getMemoryContext();
			expect(result).not.toContain("Warning");
		});

		it("includes previous notes when present (yesterday)", async () => {
			const yStr = yesterdayStr();
			await writeFile(join(tempDir, "memory", `${yStr}.md`), "yesterday stuff");

			const result = await store.getMemoryContext();
			expect(result).toContain(`## Previous Notes (${yStr})`);
			expect(result).toContain("yesterday stuff");
		});

		it("loads last 3 days of unprocessed notes", async () => {
			const dates: string[] = [];
			for (let i = 1; i <= 3; i++) {
				const d = new Date();
				d.setDate(d.getDate() - i);
				const ds = d.toISOString().slice(0, 10);
				dates.push(ds);
				await writeFile(join(tempDir, "memory", `${ds}.md`), `notes from ${i} days ago`);
			}

			const result = await store.getMemoryContext();
			// All 3 days should be present
			for (const ds of dates) {
				expect(result).toContain(`## Previous Notes (${ds})`);
			}
			expect(result).toContain("notes from 1 days ago");
			expect(result).toContain("notes from 2 days ago");
			expect(result).toContain("notes from 3 days ago");
		});

		it("orders previous notes oldest-first (3 days ago before yesterday)", async () => {
			const dates: string[] = [];
			for (let i = 1; i <= 3; i++) {
				const d = new Date();
				d.setDate(d.getDate() - i);
				const ds = d.toISOString().slice(0, 10);
				dates.push(ds);
				await writeFile(join(tempDir, "memory", `${ds}.md`), `day-${i}`);
			}

			const result = await store.getMemoryContext();
			// dates[2] is 3 days ago, dates[0] is yesterday
			const idx3 = result.indexOf(`## Previous Notes (${dates[2]})`);
			const idx1 = result.indexOf(`## Previous Notes (${dates[0]})`);
			expect(idx3).toBeLessThan(idx1);
		});

		it("omits previous notes section when no files exist", async () => {
			await writeFile(join(tempDir, "memory", "MEMORY.md"), "long-term");

			const result = await store.getMemoryContext();
			expect(result).not.toContain("Previous Notes");
		});

		it("orders sections: long-term, warning, previous notes, today", async () => {
			const largeContent = "x".repeat(9000);
			await writeFile(join(tempDir, "memory", "MEMORY.md"), largeContent);
			const today = new Date().toISOString().slice(0, 10);
			await writeFile(join(tempDir, "memory", `${today}.md`), "today");
			const yStr = yesterdayStr();
			await writeFile(join(tempDir, "memory", `${yStr}.md`), "yesterday");

			const result = await store.getMemoryContext();
			const longTermIdx = result.indexOf("## Long-term Memory");
			const warningIdx = result.indexOf("**Warning:");
			const prevIdx = result.indexOf("## Previous Notes");
			const todayIdx = result.indexOf("## Today's Notes");
			expect(longTermIdx).toBeLessThan(warningIdx);
			expect(warningIdx).toBeLessThan(prevIdx);
			expect(prevIdx).toBeLessThan(todayIdx);
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
