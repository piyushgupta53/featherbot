import { join } from "node:path";
import type { FeatherBotConfig } from "../config/schema.js";
import type { MemoryStore } from "../memory/types.js";
import { resolveWorkspaceDirs } from "../workspace/ensure-dirs.js";
import { EditFileTool } from "./edit-file-tool.js";
import { ExecTool } from "./exec-tool.js";
import { FirecrawlCrawlTool } from "./firecrawl-crawl-tool.js";
import { FirecrawlSearchTool } from "./firecrawl-search-tool.js";
import { ListDirTool } from "./list-dir-tool.js";
import { ReadFileTool } from "./read-file-tool.js";
import { RecallRecentTool } from "./recall-recent-tool.js";
import { ToolRegistry } from "./registry.js";
import { TodoTool } from "./todo-tool.js";
import { WebFetchTool } from "./web-fetch-tool.js";
import { WebSearchTool } from "./web-search-tool.js";
import { WriteFileTool } from "./write-file-tool.js";

export interface CreateToolRegistryOptions {
	memoryStore?: MemoryStore;
}

export function createToolRegistry(
	config: FeatherBotConfig,
	options?: CreateToolRegistryOptions,
): ToolRegistry {
	const workspaceDir = config.agents.defaults.workspace;
	const restrictToWorkspace = config.tools.restrictToWorkspace;
	const dirs = resolveWorkspaceDirs(
		workspaceDir,
		config.agents.defaults.dataDir,
		config.agents.defaults.scratchDir,
	);

	const registry = new ToolRegistry();

	registry.setEvictionOptions({
		threshold: config.tools.resultEvictionThreshold,
		scratchPath: dirs.scratch,
	});

	registry.register(
		new ExecTool({
			timeoutSeconds: config.tools.exec.timeout,
			workspaceDir,
			restrictToWorkspace,
			defaultCwd: dirs.scratch,
		}),
	);
	registry.register(new ReadFileTool({ workspaceDir, restrictToWorkspace }));
	registry.register(new WriteFileTool({ workspaceDir, restrictToWorkspace }));
	registry.register(new EditFileTool({ workspaceDir, restrictToWorkspace }));
	registry.register(new ListDirTool({ workspaceDir, restrictToWorkspace }));
	if (config.tools.web.search.apiKey) {
		registry.register(
			new WebSearchTool({
				apiKey: config.tools.web.search.apiKey,
				maxResults: config.tools.web.search.maxResults,
			}),
		);
	}
	registry.register(
		new WebFetchTool({
			maxContentLength: config.tools.web.fetch.maxContentLength,
			timeoutMs: config.tools.web.fetch.timeoutMs,
		}),
	);
	if (config.tools.web.firecrawl.apiKey) {
		registry.register(
			new FirecrawlSearchTool({
				apiKey: config.tools.web.firecrawl.apiKey,
				maxResults: config.tools.web.firecrawl.maxResults,
			}),
		);
		registry.register(
			new FirecrawlCrawlTool({
				apiKey: config.tools.web.firecrawl.apiKey,
				maxPages: config.tools.web.firecrawl.maxPages,
				timeoutMs: config.tools.web.firecrawl.crawlTimeoutMs,
			}),
		);
	}

	if (options?.memoryStore) {
		registry.register(new RecallRecentTool({ memoryStore: options.memoryStore }));
	}

	registry.register(
		new TodoTool({
			filePath: join(dirs.data, "todos.json"),
		}),
	);

	return registry;
}

export { CronTool } from "./cron-tool.js";
export { FirecrawlCrawlTool } from "./firecrawl-crawl-tool.js";
export type { FirecrawlCrawlToolOptions } from "./firecrawl-crawl-tool.js";
export { FirecrawlSearchTool } from "./firecrawl-search-tool.js";
export type { FirecrawlSearchToolOptions } from "./firecrawl-search-tool.js";
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
export { RecallRecentTool } from "./recall-recent-tool.js";
export type { RecallRecentToolOptions } from "./recall-recent-tool.js";
export { ToolRegistry } from "./registry.js";
export type { ToolRegistryDefinition } from "./registry.js";
export type { Tool, ToolExecutionResult } from "./types.js";
export { WebFetchTool } from "./web-fetch-tool.js";
export type { WebFetchToolOptions } from "./web-fetch-tool.js";
export { WebSearchTool } from "./web-search-tool.js";
export type { WebSearchToolOptions } from "./web-search-tool.js";
export { TodoTool } from "./todo-tool.js";
export type { TodoToolOptions, TodoItem } from "./todo-tool.js";
export { WriteFileTool } from "./write-file-tool.js";
export type { WriteFileToolOptions } from "./write-file-tool.js";
