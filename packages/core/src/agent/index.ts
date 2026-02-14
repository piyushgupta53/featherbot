import type { FeatherBotConfig } from "../config/schema.js";
import type { MemoryStore } from "../memory/types.js";
import { createProvider } from "../provider/index.js";
import type { SkillsLoader } from "../skills/loader.js";
import { createToolRegistry } from "../tools/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import { AgentLoop } from "./loop.js";
import type { StepCallback } from "./types.js";

export function createAgentLoop(
	config: FeatherBotConfig,
	options?: {
		systemPrompt?: string;
		onStepFinish?: StepCallback;
		workspacePath?: string;
		memoryStore?: MemoryStore;
		skillsLoader?: SkillsLoader;
		toolRegistry?: ToolRegistry;
	},
): AgentLoop {
	const provider = createProvider(config);
	const toolRegistry =
		options?.toolRegistry ?? createToolRegistry(config, { memoryStore: options?.memoryStore });
	return new AgentLoop({
		provider,
		toolRegistry,
		config: config.agents.defaults,
		systemPrompt: options?.systemPrompt,
		onStepFinish: options?.onStepFinish,
		workspacePath: options?.workspacePath,
		memoryStore: options?.memoryStore,
		sessionConfig: config.session,
		skillsLoader: options?.skillsLoader,
	});
}

export { ContextBuilder, parseTimezoneFromUserMd } from "./context-builder.js";
export type {
	ContextBuilderOptions,
	ContextBuilderResult,
	SessionContext,
} from "./context-builder.js";
export { InMemoryHistory } from "./history.js";
export { AgentLoop, sanitizeHistory } from "./loop.js";
export {
	ConversationSummarizer,
	isSummaryMessage,
	createSummaryMessage,
	extractSummaryText,
} from "./summarizer.js";
export type { ConversationSummarizerOptions } from "./summarizer.js";
export { buildToolMap } from "./tool-bridge.js";
export type {
	AgentLoopOptions,
	AgentLoopResult,
	ConversationHistory,
	StepCallback,
	StepEvent,
} from "./types.js";
export { SubagentManager } from "./subagent.js";
export { buildSubagentResultPrompt } from "./subagent-result-prompt.js";
export type {
	SpawnOptions,
	SubagentState,
	SubagentStatus,
} from "./subagent-types.js";
