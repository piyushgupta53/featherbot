import { MessageBus } from "@featherbot/bus";
import { BusAdapter, ChannelManager, TerminalChannel } from "@featherbot/channels";
import { createAgentLoop, loadConfig } from "@featherbot/core";
import type { Command } from "commander";

export async function runGateway(): Promise<void> {
	const config = loadConfig();
	const bus = new MessageBus();
	const agentLoop = createAgentLoop(config);
	const adapter = new BusAdapter({ bus, agentLoop });
	const channelManager = new ChannelManager({ bus });
	const terminal = new TerminalChannel({ bus });

	channelManager.register(terminal);
	adapter.start();
	await channelManager.startAll();

	const channels = channelManager.getChannels().map((ch) => ch.name);
	console.log("\nFeatherBot gateway running");
	console.log(`Active channels: ${channels.join(", ")}\n`);

	let shuttingDown = false;
	const shutdown = () => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log("\nShutting down...");
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
