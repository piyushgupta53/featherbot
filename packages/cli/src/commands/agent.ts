import { MessageBus } from "@featherbot/bus";
import { BusAdapter, ChannelManager, TerminalChannel } from "@featherbot/channels";
import { createAgentLoop, loadConfig } from "@featherbot/core";
import type { Command } from "commander";

export async function runSingleShot(message: string): Promise<void> {
	const config = loadConfig();
	const agentLoop = createAgentLoop(config);
	const result = await agentLoop.processDirect(message, {
		sessionKey: "cli:direct",
	});
	process.stdout.write(result.text);
}

export async function runRepl(): Promise<void> {
	const config = loadConfig();
	const agentLoop = createAgentLoop(config);
	const bus = new MessageBus();
	const adapter = new BusAdapter({ bus, agentLoop });
	const channelManager = new ChannelManager({ bus });
	const terminal = new TerminalChannel({
		bus,
		onStop: () => {
			adapter.stop();
			bus.close();
			process.exit(0);
		},
	});

	channelManager.register(terminal);
	adapter.start();

	const model = config.agents.defaults.model;
	console.log(`\nFeatherBot (${model})`);
	console.log("Type 'exit' to quit.\n");

	await channelManager.startAll();

	const shutdown = () => {
		channelManager.stopAll().then(() => {
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
