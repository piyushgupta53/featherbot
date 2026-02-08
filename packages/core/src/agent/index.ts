import type { FeatherBotConfig } from "../config/schema.js";
import type { MemoryStore } from "../memory/types.js";
import { createProvider } from "../provider/index.js";
import type { SkillsLoader } from "../skills/loader.js";
import { createToolRegistry } from "../tools/index.js";
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
	},
): AgentLoop {
	const provider = createProvider(config);
	const toolRegistry = createToolRegistry(config);
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

export { ContextBuilder } from "./context-builder.js";
export type {
	ContextBuilderOptions,
	ContextBuilderResult,
	SessionContext,
} from "./context-builder.js";
export { InMemoryHistory } from "./history.js";
export { AgentLoop } from "./loop.js";
export { buildToolMap } from "./tool-bridge.js";
export type {
	AgentLoopOptions,
	AgentLoopResult,
	ConversationHistory,
	StepCallback,
	StepEvent,
} from "./types.js";
