import { BUILTIN_SPECS } from "@featherbot/core";
import type { SubagentState } from "@featherbot/core";
import { describe, expect, it, vi } from "vitest";

const mockRegister = vi.fn();
const mockChannelManager = {
	register: mockRegister,
	startAll: vi.fn().mockResolvedValue(undefined),
	stopAll: vi.fn().mockResolvedValue(undefined),
	getChannels: vi.fn().mockReturnValue([]),
};

const mockProcessDirect = vi.fn().mockResolvedValue({ text: "" });
const mockPublish = vi.fn().mockResolvedValue(undefined);

// biome-ignore lint/suspicious/noExplicitAny: capture constructor args in test mock
let capturedOnComplete: ((state: any) => Promise<void>) | undefined;

vi.mock("@featherbot/bus", () => ({
	MessageBus: vi.fn(() => ({
		subscribe: vi.fn(),
		publish: mockPublish,
		close: vi.fn(),
	})),
}));

vi.mock("@featherbot/channels", () => ({
	BusAdapter: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
	ChannelManager: vi.fn(() => mockChannelManager),
	SessionQueue: vi.fn((_agent: unknown) => ({ processMessage: vi.fn(), dispose: vi.fn() })),
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
	BUILTIN_SPECS: {
		general: {
			name: "general",
			systemPrompt: "You are a FeatherBot sub-agent.",
			toolPreset: "full",
		},
		researcher: {
			name: "researcher",
			systemPrompt: "You are a FeatherBot research sub-agent.",
			toolPreset: "read-only",
		},
		coder: {
			name: "coder",
			systemPrompt: "You are a FeatherBot coding sub-agent.",
			toolPreset: "files",
		},
		analyst: {
			name: "analyst",
			systemPrompt: "You are a FeatherBot analysis sub-agent.",
			toolPreset: "full",
		},
	},
	checkStartupConfig: vi.fn(() => ({ ready: true, errors: [], warnings: [] })),
	createAgentLoop: vi.fn(() => ({
		processDirect: mockProcessDirect,
		processMessage: vi.fn(),
		getHistory: vi.fn().mockReturnValue([]),
		injectMessage: vi.fn(),
	})),
	createMemoryStore: vi.fn(() => ({
		getMemoryContext: vi.fn().mockResolvedValue(""),
		getRecentMemories: vi.fn().mockResolvedValue(""),
		getMemoryFilePath: vi.fn().mockReturnValue(""),
		getDailyNotePath: vi.fn().mockReturnValue(""),
		readMemoryFile: vi.fn().mockResolvedValue(""),
		writeMemoryFile: vi.fn().mockResolvedValue(undefined),
		readDailyNote: vi.fn().mockResolvedValue(""),
		writeDailyNote: vi.fn().mockResolvedValue(undefined),
		deleteDailyNote: vi.fn().mockResolvedValue(undefined),
		listDailyNotes: vi.fn().mockResolvedValue([]),
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
	createOutboundMessage: vi.fn((params: Record<string, unknown>) => params),
	buildSubagentResultPrompt: vi.fn((state: SubagentState) => {
		if (state.status === "completed") {
			return `summarize: ${state.task} result: ${state.result}`;
		}
		return `explain error: ${state.task} error: ${state.error}`;
	}),
	CronTool: vi.fn(),
	SpawnTool: vi.fn(),
	SubagentManager: vi.fn(
		(
			_provider: unknown,
			_config: unknown,
			onComplete: (state: SubagentState) => Promise<void>,
			_memoryStore?: unknown,
		) => {
			capturedOnComplete = onComplete;
			return {};
		},
	),
	SubagentStatusTool: vi.fn(),
	MemoryExtractor: vi.fn(() => ({
		scheduleExtraction: vi.fn(),
		scheduleUrgentExtraction: vi.fn(),
		dispose: vi.fn(),
	})),
	containsCorrectionSignal: vi.fn(() => false),
	RecallRecentTool: vi.fn(),
	Transcriber: vi.fn(),
	parseTimezoneFromUserMd: vi.fn(() => null),
	resolveWorkspaceDirs: vi.fn(() => ({
		workspace: "/tmp/ws",
		data: "/tmp/ws/data",
		scratch: "/tmp/ws/scratch",
		memory: "/tmp/ws/memory",
	})),
	ensureWorkspaceDirsSync: vi.fn(),
	cleanScratchDir: vi.fn(),
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
			anthropic: { apiKey: "" },
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

describe("subagent result summarization", () => {
	it("routes completed sub-agent results through processDirect for summarization", async () => {
		mockProcessDirect.mockResolvedValueOnce({ text: "Here are the top 3 credit cards..." });
		mockPublish.mockClear();

		createGateway(makeConfig());
		expect(capturedOnComplete).toBeDefined();

		const state: SubagentState = {
			id: "test-123",
			task: "Research credit cards",
			status: "completed",
			result: "Raw research data here",
			startedAt: new Date(),
			completedAt: new Date(),
			originChannel: "telegram",
			originChatId: "user-456",
			spec: BUILTIN_SPECS.general,
			abortController: new AbortController(),
		};

		await capturedOnComplete?.(state);

		expect(mockProcessDirect).toHaveBeenCalledWith(
			expect.stringContaining("Research credit cards"),
			{ sessionKey: "subagent-result:test-123", skipHistory: true, maxSteps: 1 },
		);

		expect(mockPublish).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "message:outbound",
				message: expect.objectContaining({
					channel: "telegram",
					chatId: "user-456",
					content: "Here are the top 3 credit cards...",
				}),
			}),
		);
	});

	it("routes failed sub-agent results through processDirect with error prompt", async () => {
		mockProcessDirect.mockResolvedValueOnce({ text: "Sorry, I couldn't complete that task." });
		mockPublish.mockClear();

		createGateway(makeConfig());

		const state: SubagentState = {
			id: "test-789",
			task: "Fetch weather data",
			status: "failed",
			error: "Network timeout",
			startedAt: new Date(),
			completedAt: new Date(),
			originChannel: "whatsapp",
			originChatId: "user-321",
			spec: BUILTIN_SPECS.general,
			abortController: new AbortController(),
		};

		await capturedOnComplete?.(state);

		expect(mockProcessDirect).toHaveBeenCalledWith(expect.stringContaining("Fetch weather data"), {
			sessionKey: "subagent-result:test-789",
			skipHistory: true,
			maxSteps: 1,
		});

		expect(mockPublish).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "message:outbound",
				message: expect.objectContaining({
					channel: "whatsapp",
					chatId: "user-321",
					content: "Sorry, I couldn't complete that task.",
				}),
			}),
		);
	});

	it("falls back to raw delivery when processDirect throws", async () => {
		mockProcessDirect.mockRejectedValueOnce(new Error("LLM unavailable"));
		mockPublish.mockClear();

		createGateway(makeConfig());

		const state: SubagentState = {
			id: "test-fallback",
			task: "Do something",
			status: "completed",
			result: "The raw result",
			startedAt: new Date(),
			completedAt: new Date(),
			originChannel: "terminal",
			originChatId: "cli",
			spec: BUILTIN_SPECS.general,
			abortController: new AbortController(),
		};

		await capturedOnComplete?.(state);

		expect(mockPublish).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "message:outbound",
				message: expect.objectContaining({
					channel: "terminal",
					chatId: "cli",
					content: expect.stringContaining("The raw result"),
				}),
			}),
		);
	});

	it("falls back to raw error delivery when processDirect throws on failed task", async () => {
		mockProcessDirect.mockRejectedValueOnce(new Error("LLM unavailable"));
		mockPublish.mockClear();

		createGateway(makeConfig());

		const state: SubagentState = {
			id: "test-fallback-err",
			task: "Broken task",
			status: "failed",
			error: "Something went wrong",
			startedAt: new Date(),
			completedAt: new Date(),
			originChannel: "telegram",
			originChatId: "user-999",
			spec: BUILTIN_SPECS.general,
			abortController: new AbortController(),
		};

		await capturedOnComplete?.(state);

		expect(mockPublish).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "message:outbound",
				message: expect.objectContaining({
					channel: "telegram",
					chatId: "user-999",
					content: expect.stringContaining("Something went wrong"),
				}),
			}),
		);
	});
});
