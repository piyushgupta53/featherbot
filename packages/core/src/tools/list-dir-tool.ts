import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { validatePath } from "./path-utils.js";
import type { Tool } from "./types.js";

export interface ListDirToolOptions {
	workspaceDir: string;
	restrictToWorkspace: boolean;
}

export class ListDirTool implements Tool {
	readonly name = "list_dir";
	readonly description = "List the contents of a directory with [dir] and [file] indicators.";
	readonly parameters = z.object({
		path: z.string().describe("The path to the directory to list"),
	});

	private options: ListDirToolOptions;

	constructor(options: ListDirToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const { path: dirPath } = params as { path: string };

		const validation = validatePath(
			dirPath,
			this.options.workspaceDir,
			this.options.restrictToWorkspace,
		);
		if (!validation.valid) {
			return `Error: ${validation.error}`;
		}

		try {
			const dirStat = await stat(validation.resolved);
			if (!dirStat.isDirectory()) {
				return `Error: '${dirPath}' is not a directory`;
			}

			const entries = await readdir(validation.resolved);
			const sorted = entries.slice().sort();

			const lines: string[] = [];
			for (const entry of sorted) {
				const entryPath = join(validation.resolved, entry);
				const entryStat = await stat(entryPath);
				const indicator = entryStat.isDirectory() ? "[dir]" : "[file]";
				lines.push(`${indicator}  ${entry}`);
			}

			return lines.join("\n");
		} catch (err) {
			if (err instanceof Error && "code" in err && err.code === "ENOENT") {
				return `Error: Directory not found: '${dirPath}'`;
			}
			const message = err instanceof Error ? err.message : String(err);
			return `Error: ${message}`;
		}
	}
}
