import { describe, expect, it, vi } from "vitest";

const mockRegister = vi.fn();
const mockChannelManager = {
	register: mockRegister,
	startAll: vi.fn().mockResolvedValue(undefined),
	stopAll: vi.fn().mockResolvedValue(undefined),
	getChannels: vi.fn().mockReturnValue([]),
};

vi.mock("@featherbot/bus", () => ({
	MessageBus: vi.fn(() => ({
		subscribe: vi.fn(),
		publish: vi.fn(),
		close: vi.fn(),
	})),
}));

vi.mock("@featherbot/channels", () => ({
	BusAdapter: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
	ChannelManager: vi.fn(() => mockChannelManager),
	TerminalChannel: vi.fn(() => ({ name: "terminal" })),
	TelegramChannel: vi.fn(() => ({ name: "telegram" })),
	WhatsAppChannel: vi.fn(() => ({ name: "whatsapp" })),
}));

vi.mock("@featherbot/core", () => ({
	Gateway: vi.fn((opts: Record<string, unknown>) => ({
		start: vi.fn(),
		stop: vi.fn(),
		getActiveChannels: vi.fn().mockReturnValue([]),
		opts,
	})),
	checkStartupConfig: vi.fn(() => ({ ready: true, errors: [], warnings: [] })),
	createAgentLoop: vi.fn(() => ({
		processDirect: vi.fn().mockResolvedValue({ text: "" }),
		processMessage: vi.fn(),
	})),
	createMemoryStore: vi.fn(() => ({
		getMemoryContext: vi.fn().mockResolvedValue(""),
		getRecentMemories: vi.fn().mockResolvedValue(""),
		getMemoryFilePath: vi.fn().mockReturnValue(""),
		getDailyNotePath: vi.fn().mockReturnValue(""),
	})),
	createSkillsLoader: vi.fn(() => ({
		getAlwaysLoadedSkills: vi.fn().mockReturnValue([]),
		buildSummary: vi.fn().mockReturnValue(""),
	})),
	createProvider: vi.fn(() => ({})),
	createToolRegistry: vi.fn(() => ({
		register: vi.fn(),
		getAll: vi.fn().mockReturnValue([]),
	})),
	loadConfig: vi.fn(),
	createOutboundMessage: vi.fn(),
	CronTool: vi.fn(),
	SpawnTool: vi.fn(),
	SubagentManager: vi.fn(() => ({})),
	SubagentStatusTool: vi.fn(),
	Transcriber: vi.fn(),
}));

vi.mock("@featherbot/scheduler", () => ({
	CronService: vi.fn(),
	HeartbeatService: vi.fn(),
	buildHeartbeatPrompt: vi.fn(),
}));

import type { FeatherBotConfig } from "@featherbot/core";
import { createGateway } from "./gateway.js";

function makeConfig(overrides?: Partial<FeatherBotConfig>): FeatherBotConfig {
	return {
		agents: {
			defaults: {
				workspace: "~/.featherbot/workspace",
				model: "anthropic/claude-sonnet-4-5-20250929",
				maxTokens: 8192,
				temperature: 0.7,
				maxToolIterations: 20,
				bootstrapFiles: [],
			},
		},
		channels: {
			telegram: { enabled: false, token: "", allowFrom: [] },
			whatsapp: { enabled: false, allowFrom: [], authDir: "~/.featherbot/whatsapp-auth" },
			discord: { enabled: false, token: "" },
		},
		providers: {
			anthropic: { apiKey: "" },
			openai: { apiKey: "" },
			openrouter: { apiKey: "" },
		},
		tools: {
			web: {
				search: { apiKey: "", maxResults: 5 },
				fetch: { maxContentLength: 50000, timeoutMs: 30000 },
			},
			exec: { timeout: 60 },
			restrictToWorkspace: false,
		},
		session: { dbPath: "", maxMessages: 50 },
		cron: { enabled: false, storePath: "" },
		heartbeat: { enabled: false, intervalMs: 1800000, heartbeatFile: "HEARTBEAT.md" },
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

describe("createGateway headless mode", () => {
	it("registers TerminalChannel when stdin is a TTY", () => {
		const original = process.stdin.isTTY;
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		mockRegister.mockClear();

		createGateway(makeConfig());

		const registeredNames = mockRegister.mock.calls.map(
			(call) => (call[0] as { name: string }).name,
		);
		expect(registeredNames).toContain("terminal");

		Object.defineProperty(process.stdin, "isTTY", { value: original, configurable: true });
	});

	it("skips TerminalChannel when stdin is not a TTY", () => {
		const original = process.stdin.isTTY;
		Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
		mockRegister.mockClear();

		createGateway(makeConfig());

		const registeredNames = mockRegister.mock.calls.map(
			(call) => (call[0] as { name: string }).name,
		);
		expect(registeredNames).not.toContain("terminal");

		Object.defineProperty(process.stdin, "isTTY", { value: original, configurable: true });
	});
});
