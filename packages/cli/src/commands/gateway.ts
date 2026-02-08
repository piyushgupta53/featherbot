import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { MessageBus } from "@featherbot/bus";
import {
	BusAdapter,
	ChannelManager,
	TelegramChannel,
	TerminalChannel,
	WhatsAppChannel,
} from "@featherbot/channels";
import {
	CronTool,
	Gateway,
	SpawnTool,
	SubagentManager,
	SubagentStatusTool,
	checkStartupConfig,
	createAgentLoop,
	createMemoryStore,
	createOutboundMessage,
	createProvider,
	createSkillsLoader,
	createToolRegistry,
	loadConfig,
} from "@featherbot/core";
import type { FeatherBotConfig, SpawnToolOriginContext } from "@featherbot/core";
import { CronService, HeartbeatService, buildHeartbeatPrompt } from "@featherbot/scheduler";
import type { Command } from "commander";

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
		const content =
			state.status === "completed"
				? `Background task completed:\nTask: ${state.task}\nResult: ${state.result}`
				: `Background task failed:\nTask: ${state.task}\nError: ${state.error}`;
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
	const memoryStore = createMemoryStore(workspace);
	const skillsLoader = createSkillsLoader({ workspacePath: workspace });

	const agentLoop = createAgentLoop(config, {
		toolRegistry,
		workspacePath: workspace,
		memoryStore,
		skillsLoader,
		onStepFinish: (event) => {
			for (const tc of event.toolCalls) {
				console.log(`[tool] ${tc.name}(${JSON.stringify(tc.arguments)})`);
			}
			for (const tr of event.toolResults) {
				const preview = tr.content.length > 200 ? `${tr.content.slice(0, 200)}...` : tr.content;
				console.log(`[tool] ${tr.toolName} → ${preview}`);
			}
		},
	});

	let heartbeatService: HeartbeatService | undefined;
	if (config.heartbeat.enabled) {
		const workspace = resolveHome(config.agents.defaults.workspace);
		heartbeatService = new HeartbeatService({
			intervalMs: config.heartbeat.intervalMs,
			heartbeatFilePath: join(workspace, config.heartbeat.heartbeatFile),
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

	if (process.stdin.isTTY) {
		channelManager.register(new TerminalChannel({ bus }));
	}

	if (config.channels.telegram.enabled && config.channels.telegram.token) {
		channelManager.register(
			new TelegramChannel({
				bus,
				token: config.channels.telegram.token,
				allowFrom: config.channels.telegram.allowFrom,
			}),
		);
	}

	if (config.channels.whatsapp.enabled) {
		channelManager.register(
			new WhatsAppChannel({
				bus,
				authDir: resolveHome(config.channels.whatsapp.authDir),
				allowFrom: config.channels.whatsapp.allowFrom,
			}),
		);
	}

	bus.subscribe("message:inbound", (event) => {
		originContext.channel = event.message.channel;
		originContext.chatId = event.message.chatId;
		if (cronTool) {
			cronTool.setContext(event.message.channel, event.message.chatId);
		}
	});

	return new Gateway({
		bus,
		adapter,
		channelManager,
		cronService,
		heartbeatService,
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
