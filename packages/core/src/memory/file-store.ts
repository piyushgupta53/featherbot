import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryStore } from "./types.js";

/** Approximate token threshold (~2000 tokens ≈ 8000 chars). */
const MEMORY_SIZE_WARNING_CHARS = 8000;

export function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export class FileMemoryStore implements MemoryStore {
	private readonly memoryDir: string;

	constructor(workspacePath: string) {
		this.memoryDir = join(workspacePath, "memory");
	}

	getMemoryFilePath(): string {
		return join(this.memoryDir, "MEMORY.md");
	}

	getDailyNotePath(date?: Date): string {
		const d = date ?? new Date();
		return join(this.memoryDir, `${formatDate(d)}.md`);
	}

	async getMemoryContext(): Promise<string> {
		const memory = (await this.readFileSafe(this.getMemoryFilePath())).trim();
		const daily = (await this.readFileSafe(this.getDailyNotePath())).trim();

		const sections: string[] = [];
		if (memory) {
			sections.push(`## Long-term Memory\n${memory}`);
			if (memory.length > MEMORY_SIZE_WARNING_CHARS) {
				sections.push(
					`**Warning: MEMORY.md is large (~${Math.round(memory.length / 4)} tokens). Review and consolidate — remove stale facts, merge duplicates, and archive resolved Pending items to keep context efficient.**`,
				);
			}
		}

		// Include the last 3 days of unprocessed notes so the agent can roll them up
		// (handles multi-day gaps where the user didn't chat for a day or two)
		for (let daysAgo = 3; daysAgo >= 1; daysAgo--) {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - daysAgo);
			const pastContent = (await this.readFileSafe(this.getDailyNotePath(pastDate))).trim();
			if (pastContent) {
				const pastDateStr = formatDate(pastDate);
				sections.push(`## Previous Notes (${pastDateStr})\n${pastContent}`);
			}
		}

		if (daily) {
			const dateStr = formatDate(new Date());
			sections.push(`## Today's Notes (${dateStr})\n${daily}`);
		}

		return sections.join("\n\n");
	}

	async getRecentMemories(days = 7): Promise<string> {
		const sections: string[] = [];
		const today = new Date();

		for (let i = 0; i < days; i++) {
			const date = new Date(today);
			date.setDate(today.getDate() - i);
			const dateStr = formatDate(date);
			const content = (await this.readFileSafe(this.getDailyNotePath(date))).trim();
			if (content) {
				sections.push(`### ${dateStr}\n${content}\n`);
			}
		}

		return sections.join("\n");
	}

	async readFileSafe(filePath: string): Promise<string> {
		try {
			const content = await readFile(filePath, "utf-8");
			return content;
		} catch (err: unknown) {
			if (err !== null && typeof err === "object" && "code" in err && err.code === "ENOENT") {
				return "";
			}
			throw err;
		}
	}
}
