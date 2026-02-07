import type { z } from "zod";

export interface InboundMessage {
	channel: string;
	senderId: string;
	chatId: string;
	content: string;
	timestamp: Date;
	media: string[];
	metadata: Record<string, unknown>;
}

export interface OutboundMessage {
	channel: string;
	chatId: string;
	content: string;
	replyTo: string | null;
	media: string[];
	metadata: Record<string, unknown>;
}

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

export type SessionKey = `${string}:${string}`;
