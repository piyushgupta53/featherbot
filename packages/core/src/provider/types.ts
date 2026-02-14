import type { ZodType } from "zod";
import type { LLMToolCall, LLMUsage, ToolDefinition, ToolResult } from "../types.js";

export interface LLMMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	toolCallId?: string;
}

export interface GenerateOptions {
	model?: string;
	messages: LLMMessage[];
	tools?: Record<string, ToolDefinition>;
	maxSteps?: number;
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
}

export interface GenerateResult {
	text: string;
	toolCalls: LLMToolCall[];
	toolResults: ToolResult[];
	usage: LLMUsage;
	finishReason: string;
}

export interface GenerateStructuredOptions<T> {
	model?: string;
	messages: LLMMessage[];
	schema: ZodType<T>;
	schemaName?: string;
	schemaDescription?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface GenerateStructuredResult<T> {
	object: T;
	usage: LLMUsage;
	finishReason: string;
}

export interface StreamPart {
	type: "text-delta" | "tool-call" | "tool-result" | "finish" | "error";
	textDelta?: string;
	toolCall?: LLMToolCall;
	toolResult?: ToolResult;
	finishReason?: string;
	error?: string;
	usage?: LLMUsage;
}

export interface StreamResult {
	textStream: AsyncIterable<string>;
	fullStream: AsyncIterable<StreamPart>;
	toTextStreamResponse: () => Response;
	result: Promise<GenerateResult>;
}

export type StreamOptions = GenerateOptions;

export interface LLMProvider {
	generate(options: GenerateOptions): Promise<GenerateResult>;
	stream(options: StreamOptions): Promise<StreamResult>;
	generateStructured<T>(
		options: GenerateStructuredOptions<T>,
	): Promise<GenerateStructuredResult<T>>;
}
