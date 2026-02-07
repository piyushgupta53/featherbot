import type { AgentConfig } from "../config/schema.js";
import type { LLMMessage, LLMProvider } from "../provider/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { LLMToolCall, LLMUsage, ToolResult } from "../types.js";

export interface AgentLoopOptions {
	provider: LLMProvider;
	toolRegistry: ToolRegistry;
	config: AgentConfig;
	systemPrompt?: string;
	onStepFinish?: StepCallback;
}

export interface AgentLoopResult {
	text: string;
	usage: LLMUsage;
	steps: number;
	finishReason: string;
	toolCalls: LLMToolCall[];
	toolResults: ToolResult[];
}

export interface StepEvent {
	stepNumber: number;
	text: string;
	toolCalls: LLMToolCall[];
	toolResults: ToolResult[];
	usage: LLMUsage;
}

export type StepCallback = (event: StepEvent) => void;

export interface ConversationHistory {
	add(message: LLMMessage): void;
	getMessages(): LLMMessage[];
	clear(): void;
	readonly length: number;
}
