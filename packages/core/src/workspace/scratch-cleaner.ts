import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function cleanScratchDir(scratchDir: string, maxAgeMs: number = SEVEN_DAYS_MS): number {
	let entries: string[];
	try {
		entries = readdirSync(scratchDir);
	} catch {
		return 0;
	}

	const now = Date.now();
	let removed = 0;

	for (const entry of entries) {
		const fullPath = join(scratchDir, entry);
		try {
			const stat = statSync(fullPath);
			if (now - stat.mtimeMs > maxAgeMs) {
				rmSync(fullPath, { recursive: true, force: true });
				removed++;
			}
		} catch {
			// Skip entries that can't be stat'd or removed.
		}
	}

	return removed;
}
