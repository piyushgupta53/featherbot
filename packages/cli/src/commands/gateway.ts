import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { MessageBus } from "@featherbot/bus";
import {
	BusAdapter,
	ChannelManager,
	SessionQueue,
	TelegramChannel,
	TerminalChannel,
	WhatsAppChannel,
} from "@featherbot/channels";
import {
	CronTool,
	Gateway,
	MemoryExtractor,
	RecallRecentTool,
	SpawnTool,
	SubagentManager,
	SubagentStatusTool,
	Transcriber,
	buildSubagentResultPrompt,
	checkStartupConfig,
	createAgentLoop,
	createMemoryStore,
	createOutboundMessage,
	createProvider,
	createSkillsLoader,
	createToolRegistry,
	ensureWorkspaceDirsSync,
	loadConfig,
	parseTimezoneFromUserMd,
	resolveWorkspaceDirs,
} from "@featherbot/core";
import { cleanScratchDir } from "@featherbot/core";
import type { FeatherBotConfig, SpawnToolOriginContext } from "@featherbot/core";
import { CronService, HeartbeatService, buildHeartbeatPrompt } from "@featherbot/scheduler";
import type { Command } from "commander";

interface HeartbeatState {
	lastProactiveSentAt?: string;
}

function getDateKey(date: Date, timezone?: string): string {
	if (!timezone) return date.toISOString().slice(0, 10);
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function readHeartbeatState(path: string): HeartbeatState {
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as HeartbeatState;
		return parsed ?? {};
	} catch {
		return {};
	}
}

function writeHeartbeatState(path: string, state: HeartbeatState): void {
	try {
		writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
	} catch {
		// Best effort only.
	}
}

function resolveHome(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : resolve(path);
}

export function createGateway(config: FeatherBotConfig): Gateway {
	const bus = new MessageBus();
	const toolRegistry = createToolRegistry(config);

	let cronService: CronService | undefined;
	let cronTool: CronTool | undefined;
	if (config.cron.enabled) {
		cronService = new CronService({
			storePath: resolveHome(config.cron.storePath),
			onJobFire: async (job) => {
				const result = await agentLoop.processDirect(job.payload.message, {
					sessionKey: `cron:${job.id}`,
				});
				if (job.payload.channel && job.payload.chatId && result.text) {
					await bus.publish({
						type: "message:outbound",
						message: createOutboundMessage({
							channel: job.payload.channel,
							chatId: job.payload.chatId,
							content: result.text,
							replyTo: null,
							media: [],
							metadata: {},
							inReplyToMessageId: null,
						}),
						timestamp: new Date(),
					});
				}
			},
		});
		cronTool = new CronTool(cronService);
		toolRegistry.register(cronTool);
	}

	const originContext: SpawnToolOriginContext = { channel: "", chatId: "" };
	const provider = createProvider(config);
	const subagentManager = new SubagentManager(provider, config, async (state) => {
		let content: string;
		try {
			const prompt = buildSubagentResultPrompt(state);
			const result = await agentLoop.processDirect(prompt, {
				sessionKey: `subagent-result:${state.id}`,
				skipHistory: true,
				maxSteps: 1,
			});
			content = result.text || `Background task ${state.status}: ${state.task}`;
		} catch {
			content =
				state.status === "completed"
					? `Background task completed:\nTask: ${state.task}\nResult: ${state.result}`
					: `Background task failed:\nTask: ${state.task}\nError: ${state.error}`;
		}
		await bus.publish({
			type: "message:outbound",
			message: createOutboundMessage({
				channel: state.originChannel,
				chatId: state.originChatId,
				content,
				replyTo: null,
				media: [],
				metadata: {},
				inReplyToMessageId: null,
			}),
			timestamp: new Date(),
		});
	});

	toolRegistry.register(new SpawnTool(subagentManager, originContext));
	toolRegistry.register(new SubagentStatusTool(subagentManager));

	const workspace = resolveHome(config.agents.defaults.workspace);
	const wsDirs = resolveWorkspaceDirs(
		workspace,
		config.agents.defaults.dataDir,
		config.agents.defaults.scratchDir,
	);
	ensureWorkspaceDirsSync(wsDirs);
	cleanScratchDir(wsDirs.scratch);
	const heartbeatStatePath = join(workspace, "memory", ".heartbeat-state.json");
	let heartbeatState = readHeartbeatState(heartbeatStatePath);
	let lastActiveRoute: { channel: string; chatId: string } | undefined;

	let userTimezone: string | undefined;
	const refreshUserTimezone = () => {
		try {
			const userMd = readFileSync(join(workspace, "USER.md"), "utf-8");
			userTimezone = parseTimezoneFromUserMd(userMd) ?? undefined;
		} catch {
			/* USER.md not found */
		}
	};
	refreshUserTimezone();

	const memoryStore = createMemoryStore(workspace, userTimezone);
	const maybeSetMemoryTimezone = (timezone?: string) => {
		const store = memoryStore as unknown as { setTimezone?: (tz?: string) => void };
		store.setTimezone?.(timezone);
	};
	maybeSetMemoryTimezone(userTimezone);
	toolRegistry.register(new RecallRecentTool({ memoryStore }));
	const skillsLoader = createSkillsLoader({ workspacePath: workspace });

	const agentLoop = createAgentLoop(config, {
		toolRegistry,
		workspacePath: workspace,
		memoryStore,
		skillsLoader,
		onStepFinish: (event) => {
			const resultsByCallId = new Map<string, string>();
			for (const tr of event.toolResults) {
				resultsByCallId.set(tr.toolCallId, tr.content);
			}
			for (const tc of event.toolCalls) {
				const args = JSON.stringify(tc.arguments);
				const result = resultsByCallId.get(tc.id);
				if (result !== undefined) {
					const preview = result.length > 200 ? `${result.slice(0, 200)}...` : result;
					console.log(`[tool] ${tc.name}(${args}) → ${preview}`);
				} else {
					console.log(`[tool] ${tc.name}(${args})`);
				}
			}
		},
	});

	const memoryExtractor = new MemoryExtractor({
		provider,
		memoryStore,
		getHistory: (key) => agentLoop.getHistory(key as `${string}:${string}`),
		idleMs: config.memory.extractionIdleMs,
		enabled: config.memory.extractionEnabled,
		model: config.memory.extractionModel,
		maxAgeMs: config.memory.extractionMaxAgeMs,
		compactionThreshold: config.memory.compactionThreshold,
	});

	let heartbeatService: HeartbeatService | undefined;
	if (config.heartbeat.enabled) {
		const workspace = resolveHome(config.agents.defaults.workspace);
		heartbeatService = new HeartbeatService({
			intervalMs: config.heartbeat.intervalMs,
			heartbeatFilePath: join(workspace, config.heartbeat.heartbeatFile),
			onTick: async (content) => {
				const prompt = buildHeartbeatPrompt(content, userTimezone);
				const result = await agentLoop.processDirect(prompt, {
					sessionKey: "system:heartbeat",
					systemPrompt: prompt,
					skipHistory: true,
				});
				if (result.text && !result.text.startsWith("SKIP")) {
					const now = new Date();
					const lastSent = heartbeatState.lastProactiveSentAt
						? new Date(heartbeatState.lastProactiveSentAt)
						: undefined;
					if (lastSent && getDateKey(lastSent, userTimezone) === getDateKey(now, userTimezone)) {
						console.log("[metrics] proactive_blocked_daily_limit");
						return;
					}
					const route =
						config.heartbeat.notifyChannel && config.heartbeat.notifyChatId
							? {
									channel: config.heartbeat.notifyChannel,
									chatId: config.heartbeat.notifyChatId,
								}
							: lastActiveRoute;
					if (!route) {
						console.warn(
							"[heartbeat] proactive message generated but no notify route configured or discovered",
						);
						return;
					}
					await bus.publish({
						type: "message:outbound",
						message: createOutboundMessage({
							channel: route.channel,
							chatId: route.chatId,
							content: result.text,
							replyTo: null,
							media: [],
							metadata: {},
							inReplyToMessageId: null,
						}),
						timestamp: new Date(),
					});
					heartbeatState = { ...heartbeatState, lastProactiveSentAt: now.toISOString() };
					writeHeartbeatState(heartbeatStatePath, heartbeatState);
					console.log("[metrics] proactive_sent");
				}
			},
		});
	}

	const transcriber =
		config.transcription.enabled && config.transcription.apiKey !== ""
			? new Transcriber(config.transcription)
			: undefined;

	const sessionQueue = new SessionQueue(agentLoop, { debounceMs: 2000 });
	const adapter = new BusAdapter({ bus, agentLoop: sessionQueue });
	const channelManager = new ChannelManager({ bus });

	if (process.stdin.isTTY) {
		channelManager.register(new TerminalChannel({ bus }));
	}

	if (config.channels.telegram.enabled && config.channels.telegram.token) {
		channelManager.register(
			new TelegramChannel({
				bus,
				token: config.channels.telegram.token,
				allowFrom: config.channels.telegram.allowFrom,
				transcriber,
			}),
		);
	}

	if (config.channels.whatsapp.enabled) {
		channelManager.register(
			new WhatsAppChannel({
				bus,
				authDir: resolveHome(config.channels.whatsapp.authDir),
				allowFrom: config.channels.whatsapp.allowFrom,
				transcriber,
			}),
		);
	}

	bus.subscribe("message:inbound", (event) => {
		refreshUserTimezone();
		maybeSetMemoryTimezone(userTimezone);
		originContext.channel = event.message.channel;
		originContext.chatId = event.message.chatId;
		lastActiveRoute = { channel: event.message.channel, chatId: event.message.chatId };
		if (cronTool) {
			cronTool.setContext(event.message.channel, event.message.chatId, userTimezone);
		}
		memoryExtractor.scheduleExtraction(`${event.message.channel}:${event.message.chatId}`);
	});

	return new Gateway({
		bus,
		adapter,
		channelManager,
		cronService,
		heartbeatService,
		onStop: async () => {
			await memoryExtractor.dispose();
			sessionQueue.dispose();
		},
	});
}

export async function runGateway(): Promise<void> {
	const config = loadConfig();

	const check = checkStartupConfig(config);
	for (const warning of check.warnings) {
		console.warn(`Warning: ${warning}`);
	}
	if (!check.ready) {
		for (const error of check.errors) {
			console.error(`Error: ${error}`);
		}
		process.exit(1);
	}

	const gateway = createGateway(config);
	await gateway.start();

	const channels = gateway.getActiveChannels();
	const headless = !process.stdin.isTTY;
	console.log(`\nFeatherBot gateway running${headless ? " (headless)" : ""}`);
	console.log(`Active channels: ${channels.join(", ")}`);
	if (config.channels.telegram.enabled) {
		console.log("Telegram: connected");
	}
	if (config.channels.whatsapp.enabled) {
		console.log("WhatsApp: connected");
	}
	if (config.cron.enabled) {
		console.log("Cron scheduler: enabled");
	}
	if (config.heartbeat.enabled) {
		const minutes = Math.round(config.heartbeat.intervalMs / 60000);
		console.log(`Heartbeat: enabled (every ${minutes}m)`);
	}
	if (config.transcription.enabled && config.transcription.apiKey !== "") {
		console.log(`Voice transcription: enabled (${config.transcription.provider})`);
	}
	if (config.memory.extractionEnabled) {
		const minutes = Math.round(config.memory.extractionIdleMs / 60000);
		console.log(`Memory extraction: enabled (${minutes}m idle)`);
	}
	console.log("Sub-agents: enabled");
	console.log("");

	const shutdown = () => {
		console.log("\nShutting down...");
		gateway.stop().then(() => process.exit(0));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

export function registerGateway(cmd: Command): void {
	cmd
		.command("gateway")
		.description("Start the agent with all available channels")
		.action(async () => {
			await runGateway();
		});
}
