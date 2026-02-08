import type { FeatherBotConfig } from "../config/schema.js";
import { EditFileTool } from "./edit-file-tool.js";
import { ExecTool } from "./exec-tool.js";
import { ListDirTool } from "./list-dir-tool.js";
import { ReadFileTool } from "./read-file-tool.js";
import { ToolRegistry } from "./registry.js";
import { WebFetchTool } from "./web-fetch-tool.js";
import { WebSearchTool } from "./web-search-tool.js";
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
	registry.register(
		new WebSearchTool({
			apiKey: config.tools.web.search.apiKey,
			maxResults: config.tools.web.search.maxResults,
		}),
	);
	registry.register(
		new WebFetchTool({
			maxContentLength: config.tools.web.fetch.maxContentLength,
			timeoutMs: config.tools.web.fetch.timeoutMs,
		}),
	);

	return registry;
}

export { CronTool } from "./cron-tool.js";
export { SpawnTool, SubagentStatusTool } from "./spawn-tool.js";
export type { SpawnToolOriginContext } from "./spawn-tool.js";
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
export { WebFetchTool } from "./web-fetch-tool.js";
export type { WebFetchToolOptions } from "./web-fetch-tool.js";
export { WebSearchTool } from "./web-search-tool.js";
export type { WebSearchToolOptions } from "./web-search-tool.js";
export { WriteFileTool } from "./write-file-tool.js";
export type { WriteFileToolOptions } from "./write-file-tool.js";
