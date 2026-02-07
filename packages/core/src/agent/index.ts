import type { FeatherBotConfig } from "../config/schema.js";
import { createProvider } from "../provider/index.js";
import { createToolRegistry } from "../tools/index.js";
import { AgentLoop } from "./loop.js";
import type { StepCallback } from "./types.js";

export function createAgentLoop(
	config: FeatherBotConfig,
	options?: { systemPrompt?: string; onStepFinish?: StepCallback },
): AgentLoop {
	const provider = createProvider(config);
	const toolRegistry = createToolRegistry(config);
	return new AgentLoop({
		provider,
		toolRegistry,
		config: config.agents.defaults,
		systemPrompt: options?.systemPrompt,
		onStepFinish: options?.onStepFinish,
	});
}

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
