import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { validatePath } from "./path-utils.js";
import type { Tool } from "./types.js";

export interface WriteFileToolOptions {
	workspaceDir: string;
	restrictToWorkspace: boolean;
}

export class WriteFileTool implements Tool {
	readonly name = "write_file";
	readonly description = "Write content to a file. Creates parent directories if they don't exist.";
	readonly parameters = z.object({
		path: z.string().describe("The path to the file to write"),
		content: z.string().describe("The content to write to the file"),
	});

	private options: WriteFileToolOptions;

	constructor(options: WriteFileToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const { path: filePath, content } = params as { path: string; content: string };

		const validation = validatePath(
			filePath,
			this.options.workspaceDir,
			this.options.restrictToWorkspace,
		);
		if (!validation.valid) {
			return `Error: ${validation.error}`;
		}

		try {
			await mkdir(dirname(validation.resolved), { recursive: true });
			await writeFile(validation.resolved, content, "utf-8");
			return `Successfully wrote ${content.length} characters to '${filePath}'`;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error: ${message}`;
		}
	}
}
