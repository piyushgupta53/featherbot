import { randomUUID } from "node:crypto";
import type { FeatherBotConfig } from "../config/schema.js";
import type { LLMProvider } from "../provider/types.js";
import { EditFileTool } from "../tools/edit-file-tool.js";
import { ExecTool } from "../tools/exec-tool.js";
import { FirecrawlCrawlTool } from "../tools/firecrawl-crawl-tool.js";
import { FirecrawlSearchTool } from "../tools/firecrawl-search-tool.js";
import { ListDirTool } from "../tools/list-dir-tool.js";
import { ReadFileTool } from "../tools/read-file-tool.js";
import { ToolRegistry } from "../tools/registry.js";
import { WebFetchTool } from "../tools/web-fetch-tool.js";
import { WebSearchTool } from "../tools/web-search-tool.js";
import { WriteFileTool } from "../tools/write-file-tool.js";
import { AgentLoop } from "./loop.js";
import type { SpawnOptions, SubagentState } from "./subagent-types.js";

const SUBAGENT_SYSTEM_PROMPT =
	"You are a FeatherBot sub-agent. Complete the given task using the available tools. Be concise and focused. Report your result clearly when done.";

export class SubagentManager {
	private readonly provider: LLMProvider;
	private readonly config: FeatherBotConfig;
	private readonly onComplete: (state: SubagentState) => void | Promise<void>;
	private readonly agents = new Map<string, SubagentState>();

	constructor(
		provider: LLMProvider,
		config: FeatherBotConfig,
		onComplete: (state: SubagentState) => void | Promise<void>,
	) {
		this.provider = provider;
		this.config = config;
		this.onComplete = onComplete;
	}

	spawn(options: SpawnOptions): string {
		const id = randomUUID();
		const state: SubagentState = {
			id,
			task: options.task,
			status: "running",
			startedAt: new Date(),
			originChannel: options.originChannel,
			originChatId: options.originChatId,
		};
		this.agents.set(id, state);

		const toolRegistry = this.createReducedToolRegistry();
		const agentConfig = {
			...this.config.agents.defaults,
			maxToolIterations: this.config.subagent.maxIterations,
		};

		const agentLoop = new AgentLoop({
			provider: this.provider,
			toolRegistry,
			config: agentConfig,
		});

		const taskPromise = agentLoop.processDirect(options.task, {
			systemPrompt: SUBAGENT_SYSTEM_PROMPT,
			sessionKey: `subagent:${id}`,
		});

		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				reject(new Error("Sub-agent timed out"));
			}, this.config.subagent.timeoutMs);
		});

		Promise.race([taskPromise, timeoutPromise])
			.then((result) => {
				state.status = "completed";
				state.result = result.text;
				state.completedAt = new Date();
				return this.onComplete(state);
			})
			.catch((err) => {
				state.status = "failed";
				state.error = err instanceof Error ? err.message : String(err);
				state.completedAt = new Date();
				return this.onComplete(state);
			});

		return id;
	}

	getState(id: string): SubagentState | undefined {
		return this.agents.get(id);
	}

	listActive(): SubagentState[] {
		return [...this.agents.values()].filter((s) => s.status === "running");
	}

	listAll(): SubagentState[] {
		return [...this.agents.values()];
	}

	private createReducedToolRegistry(): ToolRegistry {
		const workspaceDir = this.config.agents.defaults.workspace;
		const restrictToWorkspace = this.config.tools.restrictToWorkspace;
		const registry = new ToolRegistry();

		registry.register(
			new ExecTool({
				timeoutSeconds: this.config.tools.exec.timeout,
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
				apiKey: this.config.tools.web.search.apiKey,
				maxResults: this.config.tools.web.search.maxResults,
			}),
		);
		registry.register(
			new WebFetchTool({
				maxContentLength: this.config.tools.web.fetch.maxContentLength,
				timeoutMs: this.config.tools.web.fetch.timeoutMs,
			}),
		);
		registry.register(
			new FirecrawlSearchTool({
				apiKey: this.config.tools.web.firecrawl.apiKey,
				maxResults: this.config.tools.web.firecrawl.maxResults,
			}),
		);
		registry.register(
			new FirecrawlCrawlTool({
				apiKey: this.config.tools.web.firecrawl.apiKey,
				maxPages: this.config.tools.web.firecrawl.maxPages,
				timeoutMs: this.config.tools.web.firecrawl.crawlTimeoutMs,
			}),
		);

		return registry;
	}
}
