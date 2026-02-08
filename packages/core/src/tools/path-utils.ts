import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

export interface PathValidationResult {
	valid: boolean;
	resolved: string;
	error?: string;
}

function expandTilde(p: string): string {
	return p.startsWith("~") ? p.replace("~", homedir()) : p;
}

export function resolvePath(inputPath: string, workspaceDir: string): string {
	const expanded = expandTilde(inputPath);
	const expandedWorkspace = expandTilde(workspaceDir);

	if (isAbsolute(expanded)) {
		return resolve(expanded);
	}

	return resolve(expandedWorkspace, expanded);
}

export function isWithinWorkspace(absolutePath: string, workspaceDir: string): boolean {
	const normalizedPath = resolve(absolutePath);
	const normalizedWorkspace = resolve(expandTilde(workspaceDir));

	return (
		normalizedPath === normalizedWorkspace || normalizedPath.startsWith(normalizedWorkspace + sep)
	);
}

export function validatePath(
	inputPath: string,
	workspaceDir: string,
	restrictToWorkspace: boolean,
): PathValidationResult {
	const resolved = resolvePath(inputPath, workspaceDir);

	if (restrictToWorkspace && !isWithinWorkspace(resolved, workspaceDir)) {
		return {
			valid: false,
			resolved,
			error: `Path '${inputPath}' resolves to '${resolved}' which is outside the workspace '${workspaceDir}'`,
		};
	}

	return { valid: true, resolved };
}
