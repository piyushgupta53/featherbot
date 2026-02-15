import { describe, expect, it } from "vitest";
import type { FeatherBotConfig } from "./schema.js";
import { checkStartupConfig } from "./startup-check.js";

function makeConfig(overrides?: Partial<FeatherBotConfig>): FeatherBotConfig {
	return {
		agents: {
			defaults: {
				workspace: "~/.featherbot/workspace",
				dataDir: "data",
				scratchDir: "scratch",
				model: "anthropic/claude-sonnet-4-5-20250929",
				maxTokens: 8192,
				temperature: 0.7,
				maxToolIterations: 20,
				messageTimeoutMs: 300000,
				bootstrapFiles: [],
			},
		},
		channels: {
			telegram: { enabled: false, token: "", allowFrom: [] },
			whatsapp: { enabled: false, allowFrom: [], authDir: "~/.featherbot/whatsapp-auth" },
			discord: { enabled: false, token: "" },
		},
		providers: {
			anthropic: { apiKey: "sk-ant-test" },
			openai: { apiKey: "" },
			openrouter: { apiKey: "" },
		},
		tools: {
			web: {
				search: { apiKey: "", maxResults: 5 },
				fetch: { maxContentLength: 50000, timeoutMs: 30000 },
				firecrawl: { apiKey: "", maxResults: 5, maxPages: 5, crawlTimeoutMs: 60000 },
			},
			exec: { timeout: 60 },
			restrictToWorkspace: false,
			resultEvictionThreshold: 20000,
		},
		session: { dbPath: "", maxMessages: 50, summarizationEnabled: true },
		cron: { enabled: false, storePath: "" },
		heartbeat: {
			enabled: false,
			intervalMs: 600000,
			heartbeatFile: "HEARTBEAT.md",
			notifyChannel: undefined,
			notifyChatId: undefined,
		},
		memory: {
			extractionEnabled: true,
			extractionIdleMs: 300000,
			extractionModel: undefined,
			extractionMaxAgeMs: 1800000,
			compactionThreshold: 4000,
		},
		subagent: { maxIterations: 15, timeoutMs: 300000 },
		transcription: {
			enabled: false,
			provider: "groq" as const,
			apiKey: "",
			model: "",
			maxDurationSeconds: 120,
		},
		...overrides,
	};
}

describe("checkStartupConfig", () => {
	it("returns ready when API key is set for the default model provider", () => {
		const result = checkStartupConfig(makeConfig());
		expect(result.ready).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("returns error when API key is missing for default model provider", () => {
		const result = checkStartupConfig(
			makeConfig({
				providers: {
					anthropic: { apiKey: "" },
					openai: { apiKey: "" },
					openrouter: { apiKey: "" },
				},
			}),
		);
		expect(result.ready).toBe(false);
		expect(result.errors[0]).toContain("No API key");
		expect(result.errors[0]).toContain("featherbot onboard");
	});

	it("returns error when telegram is enabled but token is missing", () => {
		const result = checkStartupConfig(
			makeConfig({
				channels: {
					telegram: { enabled: true, token: "", allowFrom: [] },
					whatsapp: { enabled: false, allowFrom: [], authDir: "~/.featherbot/whatsapp-auth" },
					discord: { enabled: false, token: "" },
				},
			}),
		);
		expect(result.ready).toBe(false);
		expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("Telegram")]));
	});

	it("returns warning when whatsapp is enabled", () => {
		const result = checkStartupConfig(
			makeConfig({
				channels: {
					telegram: { enabled: false, token: "", allowFrom: [] },
					whatsapp: { enabled: true, allowFrom: [], authDir: "~/.featherbot/whatsapp-auth" },
					discord: { enabled: false, token: "" },
				},
			}),
		);
		expect(result.ready).toBe(true);
		expect(result.warnings[0]).toContain("WhatsApp");
		expect(result.warnings[0]).toContain("featherbot whatsapp login");
	});

	it("checks correct provider for openai model", () => {
		const result = checkStartupConfig(
			makeConfig({
				agents: {
					defaults: {
						workspace: "~/.featherbot/workspace",
						dataDir: "data",
						scratchDir: "scratch",
						model: "openai/gpt-4o",
						maxTokens: 8192,
						temperature: 0.7,
						maxToolIterations: 20,
						messageTimeoutMs: 300000,
						bootstrapFiles: [],
					},
				},
				providers: {
					anthropic: { apiKey: "" },
					openai: { apiKey: "sk-openai-key" },
					openrouter: { apiKey: "" },
				},
			}),
		);
		expect(result.ready).toBe(true);
	});

	it("returns no warnings when channels are disabled", () => {
		const result = checkStartupConfig(makeConfig());
		expect(result.warnings).toHaveLength(0);
	});

	it("warns when heartbeat notify route is not configured", () => {
		const result = checkStartupConfig(
			makeConfig({
				heartbeat: {
					enabled: true,
					intervalMs: 600000,
					heartbeatFile: "HEARTBEAT.md",
					notifyChannel: undefined,
					notifyChatId: undefined,
				},
			}),
		);
		expect(result.warnings).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Heartbeat notifications are not fully configured"),
			]),
		);
	});
});
