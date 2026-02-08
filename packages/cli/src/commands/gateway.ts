import { MessageBus } from "@featherbot/bus";
import { BusAdapter, ChannelManager, TerminalChannel } from "@featherbot/channels";
import {
	CronTool,
	createAgentLoop,
	createOutboundMessage,
	createToolRegistry,
	loadConfig,
} from "@featherbot/core";
import { CronService } from "@featherbot/scheduler";
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
	const adapter = new BusAdapter({ bus, agentLoop });
	const channelManager = new ChannelManager({ bus });
	const terminal = new TerminalChannel({ bus });

	channelManager.register(terminal);
	adapter.start();
	await channelManager.startAll();

	if (cronService !== undefined) {
		cronService.start();
	}

	const channels = channelManager.getChannels().map((ch) => ch.name);
	console.log("\nFeatherBot gateway running");
	console.log(`Active channels: ${channels.join(", ")}`);
	if (cronService !== undefined) {
		console.log("Cron scheduler: enabled");
	}
	console.log("");

	let shuttingDown = false;
	const shutdown = () => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log("\nShutting down...");
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
