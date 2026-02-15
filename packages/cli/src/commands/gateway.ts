import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
	containsCorrectionSignal,
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
import type { ProactiveSendRecord } from "@featherbot/scheduler";
import type { Command } from "commander";

const PROACTIVE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours between sends
const PROACTIVE_MAX_PER_DAY = 5;
const PROACTIVE_HISTORY_MAX = 20; // keep last 20 entries

interface HeartbeatState {
	lastProactiveSentAt?: string;
	recentSends?: ProactiveSendRecord[];
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

function summarize(text: string, maxLen = 120): string {
	const oneLine = text.replace(/\n/g, " ").trim();
	return oneLine.length <= maxLen ? oneLine : `${oneLine.slice(0, maxLen)}...`;
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

function resolveBuiltinSkillsDir(): string {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(currentDir, "..", "..", "..", "..", "skills"), // from src/commands/
		resolve(currentDir, "..", "..", "..", "skills"), // from dist/
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	return candidates[0] as string;
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
				const cronPrompt = [
					`A scheduled job "${job.name}" just fired.`,
					"Deliver the following message to the user as-is. Do not editorialize or add commentary — just relay it clearly.",
					"",
					job.payload.message,
				].join("\n");
				const sessionKey =
					job.payload.channel && job.payload.chatId
						? `${job.payload.channel}:${job.payload.chatId}`
						: `cron:${job.id}`;
				let content: string;
				try {
					const result = await agentLoop.processDirect(cronPrompt, {
						sessionKey,
					});
					content = result.text?.trim() || "";
				} catch (err) {
					console.error(`[cron] processDirect failed for job ${job.id}:`, err);
					content = `Scheduled reminder: ${job.payload.message}`;
				}
				if (job.payload.channel && job.payload.chatId && content) {
					await bus.publish({
						type: "message:outbound",
						message: createOutboundMessage({
							channel: job.payload.channel,
							chatId: job.payload.chatId,
							content,
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
	const skillsLoader = createSkillsLoader({
		workspacePath: workspace,
		builtinSkillsDir: resolveBuiltinSkillsDir(),
	});

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

	const subagentManager = new SubagentManager(
		provider,
		config,
		async (state) => {
			let content: string;
			try {
				const prompt = buildSubagentResultPrompt(state);
				const result = await agentLoop.processDirect(prompt, {
					sessionKey: `subagent-result:${state.id}`,
					skipHistory: true,
					maxSteps: 1,
				});
				content = result.text?.trim() || `Background task ${state.status}: ${state.task}`;
			} catch {
				content =
					state.status === "completed"
						? `Background task completed:\nTask: ${state.task}\nResult: ${state.result}`
						: `Background task ${state.status}:\nTask: ${state.task}\nError: ${state.error}`;
			}

			// Inject a brief record into the parent session history
			const parentSessionKey = `${state.originChannel}:${state.originChatId}`;
			const statusLabel = String(state.status);
			const brief = state.result
				? `[Background task ${statusLabel}: "${state.task}" — ${state.result.slice(0, 200)}]`
				: `[Background task ${statusLabel}: "${state.task}" — ${state.error ?? "done"}]`;
			agentLoop.injectMessage(parentSessionKey as `${string}:${string}`, {
				role: "assistant",
				content: brief,
			});

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
		},
		memoryStore,
	);

	toolRegistry.register(
		new SpawnTool(subagentManager, originContext, {
			getParentHistory: () => {
				const sessionKey = `${originContext.channel}:${originContext.chatId}`;
				return agentLoop.getHistory(sessionKey as `${string}:${string}`);
			},
			getMemoryContext: () => memoryStore.getMemoryContext(),
		}),
	);
	toolRegistry.register(new SubagentStatusTool(subagentManager));

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
				const sends = heartbeatState.recentSends ?? [];
				const prompt = buildHeartbeatPrompt(content, userTimezone, sends);
				const result = await agentLoop.processDirect(prompt, {
					sessionKey: "system:heartbeat",
					systemPrompt: prompt,
					skipHistory: true,
				});
				if (!result.text || result.text.trim().endsWith("SKIP")) return;

				const now = new Date();

				// Soft rate limit: 2-hour cooldown between sends
				const lastSent = heartbeatState.lastProactiveSentAt
					? new Date(heartbeatState.lastProactiveSentAt)
					: undefined;
				if (lastSent && now.getTime() - lastSent.getTime() < PROACTIVE_COOLDOWN_MS) {
					console.log("[metrics] proactive_blocked_cooldown");
					return;
				}

				// Safety cap: max N sends per calendar day
				const todayKey = getDateKey(now, userTimezone);
				const todaySends = sends.filter(
					(s) => getDateKey(new Date(s.sentAt), userTimezone) === todayKey,
				);
				if (todaySends.length >= PROACTIVE_MAX_PER_DAY) {
					console.log("[metrics] proactive_blocked_daily_cap");
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

				// Record the send with a summary
				const record: ProactiveSendRecord = {
					summary: summarize(result.text),
					sentAt: now.toISOString(),
				};
				const updated = [...sends, record].slice(-PROACTIVE_HISTORY_MAX);
				heartbeatState = {
					...heartbeatState,
					lastProactiveSentAt: now.toISOString(),
					recentSends: updated,
				};
				writeHeartbeatState(heartbeatStatePath, heartbeatState);
				console.log("[metrics] proactive_sent");
			},
		});
	}

	const transcriber =
		config.transcription.enabled && config.transcription.apiKey !== ""
			? new Transcriber(config.transcription)
			: undefined;

	const sessionQueue = new SessionQueue(agentLoop, { debounceMs: 0 });
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
		const sessionKey = `${event.message.channel}:${event.message.chatId}`;
		if (containsCorrectionSignal(event.message.content)) {
			memoryExtractor.scheduleUrgentExtraction(sessionKey);
		} else {
			memoryExtractor.scheduleExtraction(sessionKey);
		}
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
			agentLoop.close();
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
