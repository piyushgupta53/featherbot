import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { ProviderConfig } from "../config/schema.js";

type ProviderName = "anthropic" | "openai" | "openrouter";

const OPENAI_KEYWORDS = /^(gpt|o1|o3|o4)/i;
const ANTHROPIC_KEYWORDS = /claude/i;

export function parseModelString(modelString: string): {
	providerName: ProviderName;
	modelId: string;
} {
	const slashIndex = modelString.indexOf("/");
	if (slashIndex > 0) {
		const prefix = modelString.substring(0, slashIndex).toLowerCase();
		const modelId = modelString.substring(slashIndex + 1);

		if (prefix === "anthropic") {
			return { providerName: "anthropic", modelId };
		}
		if (prefix === "openai") {
			return { providerName: "openai", modelId };
		}
		if (prefix === "openrouter") {
			return { providerName: "openrouter", modelId };
		}

		return { providerName: "openrouter", modelId: modelString };
	}

	if (ANTHROPIC_KEYWORDS.test(modelString)) {
		return { providerName: "anthropic", modelId: modelString };
	}
	if (OPENAI_KEYWORDS.test(modelString)) {
		return { providerName: "openai", modelId: modelString };
	}

	return { providerName: "openrouter", modelId: modelString };
}

export function getProviderName(modelString: string): ProviderName {
	return parseModelString(modelString).providerName;
}

export function resolveModel(modelString: string, providerConfig: ProviderConfig): LanguageModel {
	const { providerName, modelId } = parseModelString(modelString);

	const apiKey = providerConfig[providerName].apiKey;
	if (!apiKey) {
		throw new Error(
			`No API key configured for provider "${providerName}". ` +
				`Set providers.${providerName}.apiKey in config or ` +
				`FEATHERBOT_providers__${providerName}__apiKey environment variable.`,
		);
	}

	switch (providerName) {
		case "anthropic": {
			const provider = createAnthropic({ apiKey });
			return provider(modelId) as LanguageModel;
		}
		case "openai": {
			const provider = createOpenAI({ apiKey });
			return provider(modelId) as LanguageModel;
		}
		case "openrouter": {
			const provider = createOpenRouter({ apiKey });
			return provider.chat(modelId) as LanguageModel;
		}
	}
}
