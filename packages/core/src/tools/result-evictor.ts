import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface EvictLargeResultOptions {
	threshold: number;
	scratchPath: string;
}

/**
 * If a tool result exceeds the character threshold, save the full content
 * to scratch/.tool-results/<uuid>.txt and return a head+tail preview
 * with a file reference.
 */
export function evictLargeResult(result: string, options: EvictLargeResultOptions): string {
	if (result.length <= options.threshold) {
		return result;
	}

	const dir = join(options.scratchPath, ".tool-results");
	mkdirSync(dir, { recursive: true });

	const id = randomUUID();
	const filePath = join(dir, `${id}.txt`);
	writeFileSync(filePath, result, "utf-8");

	const previewChars = Math.floor(options.threshold * 0.4);
	const head = result.slice(0, previewChars);
	const tail = result.slice(-previewChars);

	return [
		`[Result too large (${result.length} chars) — saved to scratch/.tool-results/${id}.txt]`,
		"",
		"=== HEAD ===",
		head,
		"",
		"=== TAIL ===",
		tail,
		"",
		`[Full content: scratch/.tool-results/${id}.txt — use read_file to access]`,
	].join("\n");
}
