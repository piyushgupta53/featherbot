import { exec } from "node:child_process";
import { z } from "zod";
import { resolvePath } from "./path-utils.js";
import type { Tool } from "./types.js";

const MAX_OUTPUT_LENGTH = 10_000;

const DENY_PATTERNS: RegExp[] = [
	/rm\s+-rf\s+\//i,
	/rm\s+-rf\s+~/i,
	/mkfs/i,
	/dd\s+if=/i,
	/:\(\)\s*\{/,
	/\bshutdown\b/i,
	/\breboot\b/i,
	/del\s+\/f/i,
];

export interface ExecToolOptions {
	timeoutSeconds: number;
	workspaceDir: string;
	restrictToWorkspace: boolean;
}

export class ExecTool implements Tool {
	readonly name = "exec";
	readonly description =
		"Execute a shell command and return the output. Use this to run CLI tools, scripts, and system commands.";
	readonly parameters = z.object({
		command: z.string().describe("The shell command to execute"),
		workingDir: z.string().optional().describe("Working directory for the command"),
	});

	private options: ExecToolOptions;

	constructor(options: ExecToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const { command, workingDir } = params as { command: string; workingDir?: string };

		const denyMatch = DENY_PATTERNS.find((pattern) => pattern.test(command));
		if (denyMatch !== undefined) {
			return "Error: Command rejected by safety filter — matches deny pattern";
		}

		let cwd: string | undefined;
		if (workingDir !== undefined) {
			cwd = resolvePath(workingDir, this.options.workspaceDir);
		} else if (this.options.restrictToWorkspace) {
			cwd = resolvePath(this.options.workspaceDir, this.options.workspaceDir);
		}

		return new Promise<string>((resolve) => {
			const child = exec(
				command,
				{
					timeout: this.options.timeoutSeconds * 1000,
					cwd,
					maxBuffer: MAX_OUTPUT_LENGTH * 2,
				},
				(error, stdout, stderr) => {
					let output = stdout + stderr;

					if (output.length > MAX_OUTPUT_LENGTH) {
						output = `${output.slice(0, MAX_OUTPUT_LENGTH)}\n... [output truncated]`;
					}

					if (error !== null) {
						if (error.killed) {
							resolve(
								`Error: Command timed out after ${this.options.timeoutSeconds}s\n${output}`.trim(),
							);
							return;
						}
						if (error.code !== undefined) {
							resolve(`Exit code: ${error.code}\n${output}`.trim());
							return;
						}
						resolve(`Error: ${error.message}\n${output}`.trim());
						return;
					}

					resolve(output.trim());
				},
			);

			child.on("error", (err) => {
				resolve(`Error: ${err.message}`);
			});
		});
	}
}
