type ProviderName = "anthropic" | "openai" | "openrouter";

export interface ModelChoice {
	id: string;
	label: string;
	description: string;
}

export const MODEL_CHOICES: Record<ProviderName, ModelChoice[]> = {
	anthropic: [
		{
			id: "anthropic/claude-sonnet-4-5-20250929",
			label: "Claude Sonnet 4.5",
			description: "Best balance of speed and intelligence (default)",
		},
		{
			id: "anthropic/claude-haiku-4-5-20251001",
			label: "Claude Haiku 3.5",
			description: "Fastest, most cost-effective",
		},
	],
	openai: [
		{
			id: "openai/gpt-4o",
			label: "GPT-4o",
			description: "Most capable OpenAI model (default)",
		},
		{
			id: "openai/gpt-4o-mini",
			label: "GPT-4o Mini",
			description: "Faster, more cost-effective",
		},
	],
	openrouter: [
		{
			id: "openrouter/anthropic/claude-sonnet-4.5",
			label: "Claude Sonnet 4.5 (via OpenRouter)",
			description: "Anthropic's best model via OpenRouter",
		},
		{
			id: "openrouter/openai/gpt-4o",
			label: "GPT-4o (via OpenRouter)",
			description: "OpenAI's best model via OpenRouter",
		},
		{
			id: "openrouter/minimax/minimax-m2.5",
			label: "MiniMax M2.5",
			description: "Cheapest frontier model — strong agentic coding (204k ctx)",
		},
		{
			id: "openrouter/moonshotai/kimi-k2.5",
			label: "Kimi K2.5",
			description: "Multimodal reasoning — visual coding & tool use (262k ctx)",
		},
	],
};
