import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceDirs {
	workspace: string;
	data: string;
	scratch: string;
	memory: string;
}

export function resolveWorkspaceDirs(
	workspacePath: string,
	dataDir: string,
	scratchDir: string,
): WorkspaceDirs {
	return {
		workspace: workspacePath,
		data: join(workspacePath, dataDir),
		scratch: join(workspacePath, scratchDir),
		memory: join(workspacePath, "memory"),
	};
}

export function ensureWorkspaceDirsSync(dirs: WorkspaceDirs): void {
	mkdirSync(dirs.data, { recursive: true });
	mkdirSync(dirs.scratch, { recursive: true });
	mkdirSync(dirs.memory, { recursive: true });
}
