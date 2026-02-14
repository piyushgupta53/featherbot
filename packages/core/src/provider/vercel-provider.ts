import { generateObject, generateText, stepCountIs, streamText } from "ai";
import type { ProviderConfig } from "../config/schema.js";
import type { LLMToolCall, LLMUsage, ToolDefinition, ToolResult } from "../types.js";
import { getProviderName, resolveModel } from "./model-resolver.js";
import { withRetry } from "./retry.js";
import type {
	GenerateOptions,
	GenerateResult,
	GenerateStructuredOptions,
	GenerateStructuredResult,
	LLMMessage,
	LLMProvider,
	StreamOptions,
	StreamPart,
	StreamResult,
} from "./types.js";

function mapToolCalls(
	toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
): LLMToolCall[] {
	return toolCalls.map((tc) => ({
		id: tc.toolCallId,
		name: tc.toolName,
		arguments: (tc.input as Record<string, unknown>) ?? {},
	}));
}

function mapToolResults(
	toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>,
): ToolResult[] {
	return toolResults.map((tr) => ({
		toolCallId: tr.toolCallId,
		toolName: tr.toolName,
		content: String(tr.output),
	}));
}

function mapUsage(usage: {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
}): LLMUsage {
	return {
		promptTokens: usage.inputTokens ?? 0,
		completionTokens: usage.outputTokens ?? 0,
		totalTokens: usage.totalTokens ?? 0,
	};
}

function buildTools(tools: Record<string, ToolDefinition>) {
	const result: Record<string, { description: string; inputSchema: unknown; execute: unknown }> =
		{};
	for (const [name, def] of Object.entries(tools)) {
		result[name] = {
			description: def.description,
			inputSchema: def.parameters,
			execute: async (params: Record<string, unknown>) => def.execute(params),
		};
	}
	return result;
}

const EMPTY_USAGE: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function mapMessages(messages: LLMMessage[], modelString?: string) {
	const isAnthropic = modelString ? getProviderName(modelString) === "anthropic" : false;

	return messages.map((msg) => {
		if (msg.role === "tool" && msg.toolCallId) {
			return {
				role: "tool" as const,
				content: [
					{
						type: "tool-result" as const,
						toolCallId: msg.toolCallId,
						toolName: "",
						output: { type: "text" as const, value: msg.content },
					},
				],
			};
		}
		if (msg.role === "system" && isAnthropic) {
			return {
				role: "system" as const,
				content: msg.content,
				providerOptions: {
					anthropic: { cacheControl: { type: "ephemeral" } },
				},
			};
		}
		return { role: msg.role as "system" | "user" | "assistant", content: msg.content };
	});
}

// biome-ignore lint/suspicious/noExplicitAny: AI SDK stream part types are complex unions, we map to our own StreamPart
async function* mapFullStream(aiStream: AsyncIterable<any>): AsyncGenerator<StreamPart> {
	try {
		for await (const part of aiStream) {
			switch (part.type) {
				case "text-delta":
					yield { type: "text-delta", textDelta: part.text };
					break;
				case "tool-call":
					yield {
						type: "tool-call",
						toolCall: {
							id: part.toolCallId,
							name: part.toolName,
							arguments: (part.input as Record<string, unknown>) ?? {},
						},
					};
					break;
				case "tool-result":
					yield {
						type: "tool-result",
						toolResult: {
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							content: String(part.output),
						},
					};
					break;
				case "finish":
					yield {
						type: "finish",
						finishReason: part.finishReason,
						usage: mapUsage(part.totalUsage),
					};
					break;
				case "error":
					yield {
						type: "error",
						error: part.error instanceof Error ? part.error.message : String(part.error),
					};
					break;
			}
		}
	} catch (error) {
		yield {
			type: "error" as const,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function createErrorStreamResult(message: string): StreamResult {
	async function* emptyStream(): AsyncGenerator<string> {}
	async function* errorStream(): AsyncGenerator<StreamPart> {
		yield { type: "error", error: message };
	}
	return {
		textStream: emptyStream(),
		fullStream: errorStream(),
		toTextStreamResponse: () => new Response(`[LLM Error] ${message}`, { status: 500 }),
		result: Promise.resolve({
			text: `[LLM Error] ${message}`,
			toolCalls: [],
			toolResults: [],
			usage: EMPTY_USAGE,
			finishReason: "error",
		}),
	};
}

export class VercelLLMProvider implements LLMProvider {
	private readonly providerConfig: ProviderConfig;
	private readonly defaultModel: string;
	private readonly defaultTemperature?: number;
	private readonly defaultMaxTokens?: number;

	constructor(options: {
		providerConfig: ProviderConfig;
		defaultModel: string;
		defaultTemperature?: number;
		defaultMaxTokens?: number;
	}) {
		this.providerConfig = options.providerConfig;
		this.defaultModel = options.defaultModel;
		this.defaultTemperature = options.defaultTemperature;
		this.defaultMaxTokens = options.defaultMaxTokens;
	}

	async generate(options: GenerateOptions): Promise<GenerateResult> {
		const modelString = options.model ?? this.defaultModel;

		try {
			const model = resolveModel(modelString, this.providerConfig);

			// biome-ignore lint/suspicious/noExplicitAny: AI SDK tools type is complex, we use our own ToolDefinition interface
			const aiTools = options.tools ? (buildTools(options.tools) as any) : undefined;

			const messages = mapMessages(options.messages, modelString);

			const result = await withRetry(() =>
				generateText({
					model,
					// biome-ignore lint/suspicious/noExplicitAny: message types are complex unions, our mapping is correct
					messages: messages as any,
					tools: aiTools,
					temperature: options.temperature ?? this.defaultTemperature,
					maxOutputTokens: options.maxTokens ?? this.defaultMaxTokens,
					stopWhen: options.maxSteps ? stepCountIs(options.maxSteps) : undefined,
					abortSignal: options.signal,
				}),
			);

			const allToolCalls = result.steps.flatMap(
				(s) =>
					s.toolCalls as unknown as Array<{
						toolCallId: string;
						toolName: string;
						input: unknown;
					}>,
			);
			const allToolResults = result.steps.flatMap(
				(s) =>
					s.toolResults as unknown as Array<{
						toolCallId: string;
						toolName: string;
						output: unknown;
					}>,
			);

			return {
				text: result.text,
				toolCalls: mapToolCalls(allToolCalls),
				toolResults: mapToolResults(allToolResults),
				usage: mapUsage(result.totalUsage),
				finishReason: result.finishReason,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				text: `[LLM Error] ${message}`,
				toolCalls: [],
				toolResults: [],
				usage: EMPTY_USAGE,
				finishReason: "error",
			};
		}
	}

	async stream(options: StreamOptions): Promise<StreamResult> {
		const modelString = options.model ?? this.defaultModel;

		try {
			const model = resolveModel(modelString, this.providerConfig);

			// biome-ignore lint/suspicious/noExplicitAny: AI SDK tools type is complex, we use our own ToolDefinition interface
			const aiTools = options.tools ? (buildTools(options.tools) as any) : undefined;

			const messages = mapMessages(options.messages, modelString);

			const aiResult = await withRetry(() =>
				streamText({
					model,
					// biome-ignore lint/suspicious/noExplicitAny: message types are complex unions, our mapping is correct
					messages: messages as any,
					tools: aiTools,
					temperature: options.temperature ?? this.defaultTemperature,
					maxOutputTokens: options.maxTokens ?? this.defaultMaxTokens,
					stopWhen: options.maxSteps ? stepCountIs(options.maxSteps) : undefined,
				}),
			);

			const resultPromise: Promise<GenerateResult> = (async () => {
				const [text, steps, usage, finishReason] = await Promise.all([
					aiResult.text,
					aiResult.steps,
					aiResult.totalUsage,
					aiResult.finishReason,
				]);
				const allToolCalls = (
					steps as Array<{ toolCalls: unknown[]; toolResults: unknown[] }>
				).flatMap(
					(s) =>
						s.toolCalls as unknown as Array<{
							toolCallId: string;
							toolName: string;
							input: unknown;
						}>,
				);
				const allToolResults = (
					steps as Array<{ toolCalls: unknown[]; toolResults: unknown[] }>
				).flatMap(
					(s) =>
						s.toolResults as unknown as Array<{
							toolCallId: string;
							toolName: string;
							output: unknown;
						}>,
				);
				return {
					text: text as string,
					toolCalls: mapToolCalls(allToolCalls),
					toolResults: mapToolResults(allToolResults),
					usage: mapUsage(
						usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number },
					),
					finishReason: finishReason as string,
				};
			})();

			return {
				textStream: aiResult.textStream,
				fullStream: mapFullStream(aiResult.fullStream),
				toTextStreamResponse: () => aiResult.toTextStreamResponse(),
				result: resultPromise,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return createErrorStreamResult(message);
		}
	}

	async generateStructured<T>(
		options: GenerateStructuredOptions<T>,
	): Promise<GenerateStructuredResult<T>> {
		const modelString = options.model ?? this.defaultModel;
		const model = resolveModel(modelString, this.providerConfig);
		const messages = mapMessages(options.messages, modelString);

		const result = await withRetry(() =>
			generateObject({
				model,
				// biome-ignore lint/suspicious/noExplicitAny: AI SDK generateObject has complex conditional types
				messages: messages as any,
				// biome-ignore lint/suspicious/noExplicitAny: AI SDK generateObject has complex conditional types
				schema: options.schema as any,
				schemaName: options.schemaName,
				schemaDescription: options.schemaDescription,
				temperature: options.temperature ?? this.defaultTemperature,
				maxOutputTokens: options.maxTokens ?? this.defaultMaxTokens,
			}),
		);

		return {
			object: result.object as T,
			usage: mapUsage(result.usage),
			finishReason: result.finishReason,
		};
	}
}
