import { z } from "zod";

export const DEFAULT_BOOTSTRAP_FILES = [
	"AGENTS.md",
	"SOUL.md",
	"USER.md",
	"TOOLS.md",
	"IDENTITY.md",
];

export const AgentConfigSchema = z.object({
	workspace: z.string().default("~/.featherbot/workspace"),
	model: z.string().default("anthropic/claude-sonnet-4-5-20250929"),
	maxTokens: z.number().int().positive().default(8192),
	temperature: z.number().min(0).max(2).default(0.7),
	maxToolIterations: z.number().int().positive().default(20),
	bootstrapFiles: z.array(z.string()).default(DEFAULT_BOOTSTRAP_FILES),
});

export const TelegramChannelConfigSchema = z.object({
	enabled: z.boolean().default(false),
	token: z.string().default(""),
	allowFrom: z.array(z.string()).default([]),
});

export const WhatsAppChannelConfigSchema = z.object({
	enabled: z.boolean().default(false),
	bridgeUrl: z.string().default("ws://localhost:3001"),
});

export const DiscordChannelConfigSchema = z.object({
	enabled: z.boolean().default(false),
	token: z.string().default(""),
});

export const ChannelConfigSchema = z.object({
	telegram: TelegramChannelConfigSchema.default({}),
	whatsapp: WhatsAppChannelConfigSchema.default({}),
	discord: DiscordChannelConfigSchema.default({}),
});

export const ProviderEntrySchema = z.object({
	apiKey: z.string().default(""),
});

export const ProviderConfigSchema = z.object({
	anthropic: ProviderEntrySchema.default({}),
	openai: ProviderEntrySchema.default({}),
	openrouter: ProviderEntrySchema.default({}),
});

export const WebSearchToolConfigSchema = z.object({
	apiKey: z.string().default(""),
	maxResults: z.number().int().positive().default(5),
});

export const ExecToolConfigSchema = z.object({
	timeout: z.number().int().positive().default(60),
});

export const ToolConfigSchema = z.object({
	web: z.object({ search: WebSearchToolConfigSchema.default({}) }).default({}),
	exec: ExecToolConfigSchema.default({}),
	restrictToWorkspace: z.boolean().default(false),
});

export const SessionConfigSchema = z.object({
	dbPath: z.string().default("~/.featherbot/sessions.db"),
	maxMessages: z.number().int().positive().default(50),
});

export const CronConfigSchema = z.object({
	enabled: z.boolean().default(true),
	storePath: z.string().default("~/.featherbot/cron.json"),
});

export const FeatherBotConfigSchema = z.object({
	agents: z.object({ defaults: AgentConfigSchema.default({}) }).default({}),
	channels: ChannelConfigSchema.default({}),
	providers: ProviderConfigSchema.default({}),
	tools: ToolConfigSchema.default({}),
	session: SessionConfigSchema.default({}),
	cron: CronConfigSchema.default({}),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type CronConfig = z.infer<typeof CronConfigSchema>;
export type FeatherBotConfig = z.infer<typeof FeatherBotConfigSchema>;
