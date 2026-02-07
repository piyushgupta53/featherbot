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
	LLMUsage,
	OutboundMessage,
	SessionKey,
	ToolDefinition,
	ToolResult,
} from "./types.js";
export { createProvider, resolveModel, VercelLLMProvider, withRetry } from "./provider/index.js";
export type { RetryOptions } from "./provider/index.js";
export type {
	GenerateOptions,
	GenerateResult,
	LLMMessage,
	LLMProvider,
	StreamOptions,
	StreamPart,
	StreamResult,
} from "./provider/index.js";
export {
	createToolRegistry,
	EditFileTool,
	ExecTool,
	ListDirTool,
	ReadFileTool,
	ToolRegistry,
	WriteFileTool,
} from "./tools/index.js";
export { isWithinWorkspace, resolvePath, validatePath } from "./tools/index.js";
export type {
	EditFileToolOptions,
	ExecToolOptions,
	ListDirToolOptions,
	PathValidationResult,
	ReadFileToolOptions,
	Tool,
	ToolExecutionResult,
	ToolRegistryDefinition,
	WriteFileToolOptions,
} from "./tools/index.js";
