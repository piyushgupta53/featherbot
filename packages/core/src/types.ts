import type { z } from "zod";

export type {
	InboundMessage,
	OutboundMessage,
	SessionKey,
} from "@featherbot/bus";

export interface ToolDefinition {
	name: string;
	description: string;
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject requires type params that vary per tool
	parameters: z.ZodObject<any>;
	execute: (params: Record<string, unknown>) => Promise<string>;
}

export interface ToolResult {
	toolName: string;
	toolCallId: string;
	content: string;
}

export interface LLMToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface LLMUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export interface LLMResponse {
	content: string | null;
	toolCalls: LLMToolCall[];
	usage: LLMUsage;
	finishReason: string;
}
