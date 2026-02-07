import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { validatePath } from "./path-utils.js";
import type { Tool } from "./types.js";

export interface EditFileToolOptions {
	workspaceDir: string;
	restrictToWorkspace: boolean;
}

export class EditFileTool implements Tool {
	readonly name = "edit_file";
	readonly description =
		"Edit a file by replacing an exact text match. Requires the old text to appear exactly once in the file.";
	readonly parameters = z.object({
		path: z.string().describe("The path to the file to edit"),
		oldText: z.string().describe("The exact text to find and replace"),
		newText: z.string().describe("The replacement text"),
	});

	private options: EditFileToolOptions;

	constructor(options: EditFileToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const {
			path: filePath,
			oldText,
			newText,
		} = params as {
			path: string;
			oldText: string;
			newText: string;
		};

		const validation = validatePath(
			filePath,
			this.options.workspaceDir,
			this.options.restrictToWorkspace,
		);
		if (!validation.valid) {
			return `Error: ${validation.error}`;
		}

		try {
			const content = await readFile(validation.resolved, "utf-8");

			const occurrences = countOccurrences(content, oldText);
			if (occurrences === 0) {
				return `Error: oldText not found in '${filePath}'`;
			}
			if (occurrences > 1) {
				return `Error: oldText appears ${occurrences} times in '${filePath}' (ambiguous match). Provide more surrounding context to make the match unique.`;
			}

			const updated = content.replace(oldText, newText);
			await writeFile(validation.resolved, updated, "utf-8");
			return `Successfully edited '${filePath}'`;
		} catch (err) {
			if (err instanceof Error && "code" in err && err.code === "ENOENT") {
				return `Error: File not found: '${filePath}'`;
			}
			const message = err instanceof Error ? err.message : String(err);
			return `Error: ${message}`;
		}
	}
}

function countOccurrences(text: string, search: string): number {
	let count = 0;
	let pos = 0;
	while (true) {
		const index = text.indexOf(search, pos);
		if (index === -1) break;
		count++;
		pos = index + 1;
	}
	return count;
}
