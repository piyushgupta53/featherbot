import type { FeatherBotConfig } from "../config/schema.js";
import { EditFileTool } from "./edit-file-tool.js";
import { ExecTool } from "./exec-tool.js";
import { ListDirTool } from "./list-dir-tool.js";
import { ReadFileTool } from "./read-file-tool.js";
import { ToolRegistry } from "./registry.js";
import { WriteFileTool } from "./write-file-tool.js";

export function createToolRegistry(config: FeatherBotConfig): ToolRegistry {
	const workspaceDir = config.agents.defaults.workspace;
	const restrictToWorkspace = config.tools.restrictToWorkspace;

	const registry = new ToolRegistry();

	registry.register(
		new ExecTool({
			timeoutSeconds: config.tools.exec.timeout,
			workspaceDir,
			restrictToWorkspace,
		}),
	);
	registry.register(new ReadFileTool({ workspaceDir, restrictToWorkspace }));
	registry.register(new WriteFileTool({ workspaceDir, restrictToWorkspace }));
	registry.register(new EditFileTool({ workspaceDir, restrictToWorkspace }));
	registry.register(new ListDirTool({ workspaceDir, restrictToWorkspace }));

	return registry;
}

export { CronTool } from "./cron-tool.js";
export { EditFileTool } from "./edit-file-tool.js";
export type { EditFileToolOptions } from "./edit-file-tool.js";
export { ExecTool } from "./exec-tool.js";
export type { ExecToolOptions } from "./exec-tool.js";
export { ListDirTool } from "./list-dir-tool.js";
export type { ListDirToolOptions } from "./list-dir-tool.js";
export { isWithinWorkspace, resolvePath, validatePath } from "./path-utils.js";
export type { PathValidationResult } from "./path-utils.js";
export { ReadFileTool } from "./read-file-tool.js";
export type { ReadFileToolOptions } from "./read-file-tool.js";
export { ToolRegistry } from "./registry.js";
export type { ToolRegistryDefinition } from "./registry.js";
export type { Tool, ToolExecutionResult } from "./types.js";
export { WriteFileTool } from "./write-file-tool.js";
export type { WriteFileToolOptions } from "./write-file-tool.js";
