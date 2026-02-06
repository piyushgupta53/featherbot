export const VERSION = "0.0.1";

export {
	AgentConfigSchema,
	ChannelConfigSchema,
	DiscordChannelConfigSchema,
	ExecToolConfigSchema,
	FeatherBotConfigSchema,
	ProviderConfigSchema,
	ProviderEntrySchema,
	TelegramChannelConfigSchema,
	ToolConfigSchema,
	WebSearchToolConfigSchema,
	WhatsAppChannelConfigSchema,
} from "./config/schema.js";
export type {
	AgentConfig,
	ChannelConfig,
	FeatherBotConfig,
	ProviderConfig,
	ToolConfig,
} from "./config/schema.js";
export { loadConfig } from "./config/loader.js";
export type {
	InboundMessage,
	LLMResponse,
	LLMToolCall,
	OutboundMessage,
	SessionKey,
	ToolDefinition,
	ToolResult,
} from "./types.js";
