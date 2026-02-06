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
	parameters: z.ZodType;
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

export interface LLMResponse {
	content: string | null;
	toolCalls: LLMToolCall[];
}

export type SessionKey = `${string}:${string}`;
