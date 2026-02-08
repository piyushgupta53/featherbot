export const VERSION = "0.0.1";

export {
	AgentConfigSchema,
	ChannelConfigSchema,
	DEFAULT_BOOTSTRAP_FILES,
	DiscordChannelConfigSchema,
	ExecToolConfigSchema,
	FeatherBotConfigSchema,
	ProviderConfigSchema,
	ProviderEntrySchema,
	SessionConfigSchema,
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
	SessionConfig,
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
export { createInboundMessage, createOutboundMessage, MessageBus } from "@featherbot/bus";
export type {
	BusErrorEvent,
	BusEvent,
	BusEventHandler,
	BusEventType,
	InboundMessageEvent,
	MessageBusOptions,
	OutboundMessageEvent,
} from "@featherbot/bus";
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
export {
	AgentLoop,
	buildToolMap,
	ContextBuilder,
	createAgentLoop,
	InMemoryHistory,
} from "./agent/index.js";
export type {
	AgentLoopOptions,
	AgentLoopResult,
	ContextBuilderOptions,
	ContextBuilderResult,
	ConversationHistory,
	SessionContext,
	StepCallback,
	StepEvent,
} from "./agent/index.js";
export { createMemoryStore, FileMemoryStore } from "./memory/index.js";
export type { MemoryStore } from "./memory/index.js";
export {
	createSkillsLoader,
	parseFrontmatter,
	SkillMetadataSchema,
	SkillRequirementsSchema,
	SkillsLoader,
} from "./skills/index.js";
export type {
	ParsedFrontmatter,
	Skill,
	SkillMetadata,
	SkillRequirements,
	SkillsLoaderOptions,
	SkillSource,
} from "./skills/index.js";
export {
	createHistory,
	createSessionStore,
	initDatabase,
	SessionStore,
	SqliteHistory,
} from "./session/index.js";
export type { SessionRecord } from "./session/index.js";
