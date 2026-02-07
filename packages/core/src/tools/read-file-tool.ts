import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { validatePath } from "./path-utils.js";
import type { Tool } from "./types.js";

export interface ReadFileToolOptions {
	workspaceDir: string;
	restrictToWorkspace: boolean;
}

export class ReadFileTool implements Tool {
	readonly name = "read_file";
	readonly description = "Read the contents of a file as UTF-8 text.";
	readonly parameters = z.object({
		path: z.string().describe("The path to the file to read"),
	});

	private options: ReadFileToolOptions;

	constructor(options: ReadFileToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const { path: filePath } = params as { path: string };

		const validation = validatePath(
			filePath,
			this.options.workspaceDir,
			this.options.restrictToWorkspace,
		);
		if (!validation.valid) {
			return `Error: ${validation.error}`;
		}

		try {
			const fileStat = await stat(validation.resolved);
			if (fileStat.isDirectory()) {
				return `Error: '${filePath}' is a directory, not a file`;
			}

			return await readFile(validation.resolved, "utf-8");
		} catch (err) {
			if (err instanceof Error && "code" in err && err.code === "ENOENT") {
				return `Error: File not found: '${filePath}'`;
			}
			const message = err instanceof Error ? err.message : String(err);
			return `Error: ${message}`;
		}
	}
}
