export const VERSION = "0.0.1";

export {
	AgentConfigSchema,
	ChannelConfigSchema,
	CronConfigSchema,
	DEFAULT_BOOTSTRAP_FILES,
	HeartbeatConfigSchema,
	MemoryConfigSchema,
	DiscordChannelConfigSchema,
	ExecToolConfigSchema,
	FeatherBotConfigSchema,
	FirecrawlConfigSchema,
	ProviderConfigSchema,
	ProviderEntrySchema,
	SessionConfigSchema,
	SubagentConfigSchema,
	TelegramChannelConfigSchema,
	TranscriptionConfigSchema,
	ToolConfigSchema,
	WebSearchToolConfigSchema,
	WhatsAppChannelConfigSchema,
} from "./config/schema.js";
export type {
	AgentConfig,
	ChannelConfig,
	CronConfig,
	FeatherBotConfig,
	FirecrawlConfig,
	HeartbeatConfig,
	MemoryConfig,
	ProviderConfig,
	SessionConfig,
	SubagentConfig,
	ToolConfig,
	TranscriptionConfig,
	WhatsAppConfig,
} from "./config/schema.js";
export { loadConfig } from "./config/loader.js";
export { detectProvider, validateApiKeyFormat } from "./config/validate-key.js";
export { MODEL_CHOICES } from "./config/model-choices.js";
export type { ModelChoice } from "./config/model-choices.js";
export { checkStartupConfig } from "./config/startup-check.js";
export type { StartupCheckResult } from "./config/startup-check.js";
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
	GenerateStructuredOptions,
	GenerateStructuredResult,
	LLMMessage,
	LLMProvider,
	StreamOptions,
	StreamPart,
	StreamResult,
} from "./provider/index.js";
export {
	createToolRegistry,
	CronTool,
	EditFileTool,
	ExecTool,
	FirecrawlCrawlTool,
	FirecrawlSearchTool,
	ListDirTool,
	ReadFileTool,
	RecallRecentTool,
	SpawnTool,
	SubagentStatusTool,
	ToolRegistry,
	WriteFileTool,
} from "./tools/index.js";
export { isWithinWorkspace, resolvePath, validatePath } from "./tools/index.js";
export type {
	EditFileToolOptions,
	ExecToolOptions,
	FirecrawlCrawlToolOptions,
	FirecrawlSearchToolOptions,
	ListDirToolOptions,
	PathValidationResult,
	ReadFileToolOptions,
	RecallRecentToolOptions,
	SpawnToolOriginContext,
	Tool,
	ToolExecutionResult,
	ToolRegistryDefinition,
	WriteFileToolOptions,
} from "./tools/index.js";
export {
	AgentLoop,
	buildSubagentResultPrompt,
	buildToolMap,
	ContextBuilder,
	createAgentLoop,
	InMemoryHistory,
	parseTimezoneFromUserMd,
	SubagentManager,
} from "./agent/index.js";
export type {
	AgentLoopOptions,
	AgentLoopResult,
	ContextBuilderOptions,
	ContextBuilderResult,
	ConversationHistory,
	SessionContext,
	SpawnOptions,
	StepCallback,
	StepEvent,
	SubagentState,
	SubagentStatus,
} from "./agent/index.js";
export {
	createMemoryStore,
	FileMemoryStore,
	MemoryExtractor,
	ExtractionResultSchema,
	CompactionResultSchema,
	parseMemoryMarkdown,
	renderMemoryMarkdown,
	mergeExtraction,
	formatDailyNote,
	appendToExistingNote,
	extractImportantItems,
	performRollup,
} from "./memory/index.js";
export type {
	MemoryExtractorOptions,
	MemoryStore,
	ExtractionResult,
	CompactionResult,
	ParsedMemory,
	RollupResult,
} from "./memory/index.js";
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
export { Transcriber } from "./transcription/index.js";
export type { TranscriptionResult } from "./transcription/index.js";
export { Gateway } from "./gateway/index.js";
export type {
	GatewayAdapter,
	GatewayBus,
	GatewayChannelManager,
	GatewayCronService,
	GatewayHeartbeatService,
	GatewayOptions,
} from "./gateway/index.js";
export { cleanScratchDir } from "./workspace/scratch-cleaner.js";
export { ensureWorkspaceDirsSync, resolveWorkspaceDirs } from "./workspace/ensure-dirs.js";
export type { WorkspaceDirs } from "./workspace/ensure-dirs.js";
