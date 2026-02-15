import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MessageBus } from "@featherbot/bus";
import { BusAdapter, ChannelManager, TerminalChannel } from "@featherbot/channels";
import {
	MemoryExtractor,
	RecallRecentTool,
	checkStartupConfig,
	containsCorrectionSignal,
	createAgentLoop,
	createMemoryStore,
	createOutboundMessage,
	createProvider,
	createSkillsLoader,
	createToolRegistry,
	loadConfig,
	parseTimezoneFromUserMd,
} from "@featherbot/core";
import { HeartbeatService, buildHeartbeatPrompt } from "@featherbot/scheduler";
import type { ProactiveSendRecord } from "@featherbot/scheduler";
import type { Command } from "commander";

const PROACTIVE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours between sends
const PROACTIVE_MAX_PER_DAY = 5;
const PROACTIVE_HISTORY_MAX = 20; // keep last 20 entries

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
		return (JSON.parse(raw) as HeartbeatState) ?? {};
	} catch {
		return {};
	}
}

function writeHeartbeatState(path: string, state: HeartbeatState): void {
	try {
		writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
	} catch {
		// Best effort.
	}
}

function validateOrExit(config: ReturnType<typeof loadConfig>): void {
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
}

function createConfiguredLoop(config: ReturnType<typeof loadConfig>) {
	const workspace = resolveHome(config.agents.defaults.workspace);
	let userTimezone: string | undefined;
	const refreshUserTimezone = () => {
		try {
			const userMd = readFileSync(join(workspace, "USER.md"), "utf-8");
			userTimezone = parseTimezoneFromUserMd(userMd) ?? undefined;
		} catch {
			/* USER.md missing */
		}
	};
	refreshUserTimezone();
	const memoryStore = createMemoryStore(workspace, userTimezone);
	const skillsLoader = createSkillsLoader({
		workspacePath: workspace,
		builtinSkillsDir: resolveBuiltinSkillsDir(),
	});
	return createAgentLoop(config, {
		workspacePath: workspace,
		memoryStore,
		skillsLoader,
	});
}

export async function runSingleShot(message: string): Promise<void> {
	const config = loadConfig();
	validateOrExit(config);
	const agentLoop = createConfiguredLoop(config);
	const result = await agentLoop.processDirect(message, {
		sessionKey: "cli:direct",
	});
	process.stdout.write(result.text);
}

export async function runRepl(): Promise<void> {
	const config = loadConfig();
	validateOrExit(config);
	const workspace = resolveHome(config.agents.defaults.workspace);
	let userTimezone: string | undefined;
	const refreshUserTimezone = () => {
		try {
			const userMd = readFileSync(join(workspace, "USER.md"), "utf-8");
			userTimezone = parseTimezoneFromUserMd(userMd) ?? undefined;
		} catch {
			/* USER.md missing */
		}
	};
	refreshUserTimezone();

	const provider = createProvider(config);
	const toolRegistry = createToolRegistry(config);
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
	});
	const bus = new MessageBus();
	const adapter = new BusAdapter({ bus, agentLoop });
	const channelManager = new ChannelManager({ bus });
	const heartbeatStatePath = join(workspace, "memory", ".heartbeat-state.json");
	let heartbeatState = readHeartbeatState(heartbeatStatePath);
	let heartbeatService: HeartbeatService | undefined;
	// biome-ignore lint/style/useConst: assigned after TerminalChannel closure captures it
	let memoryExtractor: MemoryExtractor | undefined;
	const terminal = new TerminalChannel({
		bus,
		onStop: () => {
			heartbeatService?.stop();
			memoryExtractor?.dispose().catch(() => {});
			adapter.stop();
			bus.close();
			process.exit(0);
		},
	});

	channelManager.register(terminal);
	adapter.start();

	memoryExtractor = new MemoryExtractor({
		provider,
		memoryStore,
		getHistory: (key) => agentLoop.getHistory(key as `${string}:${string}`),
		idleMs: config.memory.extractionIdleMs,
		enabled: config.memory.extractionEnabled,
		model: config.memory.extractionModel,
		maxAgeMs: config.memory.extractionMaxAgeMs,
		compactionThreshold: config.memory.compactionThreshold,
	});

	bus.subscribe("message:inbound", (event) => {
		refreshUserTimezone();
		maybeSetMemoryTimezone(userTimezone);
		const sessionKey = `${event.message.channel}:${event.message.chatId}`;
		if (containsCorrectionSignal(event.message.content)) {
			memoryExtractor?.scheduleUrgentExtraction(sessionKey);
		} else {
			memoryExtractor?.scheduleExtraction(sessionKey);
		}
	});

	if (config.heartbeat.enabled) {
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

				await bus.publish({
					type: "message:outbound",
					message: createOutboundMessage({
						channel: "terminal",
						chatId: "terminal:default",
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
		heartbeatService.start();
	}

	const model = config.agents.defaults.model;
	console.log(`\nFeatherBot (${model})`);
	console.log("Type 'exit' to quit.\n");

	await channelManager.startAll();

	const shutdown = () => {
		channelManager.stopAll().then(() => {
			heartbeatService?.stop();
			memoryExtractor?.dispose().catch(() => {});
			adapter.stop();
			bus.close();
			process.exit(0);
		});
	};
	process.on("SIGINT", shutdown);
}

export function registerAgent(cmd: Command): void {
	cmd
		.command("agent")
		.description("Chat with the agent (REPL or single-shot)")
		.option("-m, --message <message>", "Send a single message and exit")
		.action(async (opts: { message?: string }) => {
			if (opts.message !== undefined) {
				try {
					await runSingleShot(opts.message);
				} catch (err) {
					const errorText = err instanceof Error ? err.message : String(err);
					process.stderr.write(`Error: ${errorText}\n`);
					process.exit(1);
				}
			} else {
				await runRepl();
			}
		});
}
