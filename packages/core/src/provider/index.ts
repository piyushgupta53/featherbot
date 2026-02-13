import type { FeatherBotConfig } from "../config/schema.js";
import type { LLMProvider } from "./types.js";
import { VercelLLMProvider } from "./vercel-provider.js";

export function createProvider(config: FeatherBotConfig): LLMProvider {
	const defaults = config.agents.defaults;
	return new VercelLLMProvider({
		providerConfig: config.providers,
		defaultModel: defaults.model,
		defaultTemperature: defaults.temperature,
		defaultMaxTokens: defaults.maxTokens,
	});
}

export { resolveModel } from "./model-resolver.js";
export { VercelLLMProvider } from "./vercel-provider.js";
export { withRetry } from "./retry.js";
export type { RetryOptions } from "./retry.js";
export {
	extractJsonFromText,
	generateStructuredWithFallback,
	zodSchemaToJsonExample,
} from "./structured-fallback.js";
export type { StructuredFallbackOptions } from "./structured-fallback.js";
export type {
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
