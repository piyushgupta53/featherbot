import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { MessageBus } from "@featherbot/bus";
import { BusAdapter, ChannelManager, TelegramChannel, TerminalChannel } from "@featherbot/channels";
import {
	CronTool,
	createAgentLoop,
	createOutboundMessage,
	createToolRegistry,
	loadConfig,
} from "@featherbot/core";
import { CronService, HeartbeatService, buildHeartbeatPrompt } from "@featherbot/scheduler";
import type { Command } from "commander";

export async function runGateway(): Promise<void> {
	const config = loadConfig();
	const bus = new MessageBus();

	const toolRegistry = createToolRegistry(config);

	let cronService: CronService | undefined;
	let cronTool: CronTool | undefined;

	if (config.cron.enabled) {
		cronService = new CronService({
			storePath: config.cron.storePath,
			onJobFire: async (job) => {
				const agentResult = await agentLoop.processDirect(job.payload.message, {
					sessionKey: `cron:${job.id}`,
				});
				if (job.payload.channel && job.payload.chatId && agentResult.text) {
					const outbound = createOutboundMessage({
						channel: job.payload.channel,
						chatId: job.payload.chatId,
						content: agentResult.text,
						replyTo: null,
						media: [],
						metadata: {},
						inReplyToMessageId: null,
					});
					await bus.publish({
						type: "message:outbound",
						message: outbound,
						timestamp: new Date(),
					});
				}
			},
		});

		cronTool = new CronTool(cronService);
		toolRegistry.register(cronTool);
	}

	const agentLoop = createAgentLoop(config, { toolRegistry });

	let heartbeatService: HeartbeatService | undefined;

	if (config.heartbeat.enabled) {
		const workspace = config.agents.defaults.workspace.startsWith("~")
			? join(homedir(), config.agents.defaults.workspace.slice(1))
			: resolve(config.agents.defaults.workspace);
		const heartbeatFilePath = join(workspace, config.heartbeat.heartbeatFile);

		heartbeatService = new HeartbeatService({
			intervalMs: config.heartbeat.intervalMs,
			heartbeatFilePath,
			onTick: async (content) => {
				const prompt = buildHeartbeatPrompt(content);
				await agentLoop.processDirect(prompt, {
					sessionKey: "system:heartbeat",
					systemPrompt: prompt,
				});
			},
		});
	}

	const adapter = new BusAdapter({ bus, agentLoop });
	const channelManager = new ChannelManager({ bus });
	const terminal = new TerminalChannel({ bus });
	channelManager.register(terminal);

	if (config.channels.telegram.enabled && config.channels.telegram.token) {
		const telegram = new TelegramChannel({
			bus,
			token: config.channels.telegram.token,
			allowFrom: config.channels.telegram.allowFrom,
		});
		channelManager.register(telegram);
	}
	adapter.start();
	await channelManager.startAll();

	if (cronService !== undefined) {
		cronService.start();
	}

	if (heartbeatService !== undefined) {
		heartbeatService.start();
	}

	const channels = channelManager.getChannels().map((ch) => ch.name);
	console.log("\nFeatherBot gateway running");
	console.log(`Active channels: ${channels.join(", ")}`);
	if (config.channels.telegram.enabled) {
		console.log("Telegram: connected");
	}
	if (cronService !== undefined) {
		console.log("Cron scheduler: enabled");
	}
	if (heartbeatService !== undefined) {
		const minutes = Math.round(config.heartbeat.intervalMs / 60000);
		console.log(`Heartbeat: enabled (every ${minutes}m)`);
	}
	console.log("");

	let shuttingDown = false;
	const shutdown = () => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log("\nShutting down...");
		if (heartbeatService !== undefined) {
			heartbeatService.stop();
		}
		if (cronService !== undefined) {
			cronService.stop();
		}
		channelManager.stopAll().then(() => {
			adapter.stop();
			bus.close();
			process.exit(0);
		});
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
