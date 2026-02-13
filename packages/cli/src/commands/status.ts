import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { FeatherBotConfig } from "@featherbot/core";
import { loadConfig } from "@featherbot/core";
import type { Command } from "commander";

export function maskKey(key: string): string {
	if (key === "") return "not configured";
	if (key.length < 8) return "****";
	return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function formatStatus(config: FeatherBotConfig, configPath: string): string {
	const lines: string[] = [];
	const configExists = existsSync(configPath);

	lines.push("FeatherBot Status");
	lines.push("=================");
	lines.push("");

	// Config
	lines.push("Config:");
	lines.push(`  Path:   ${configPath}`);
	lines.push(`  Exists: ${configExists ? "yes" : "no"}`);
	lines.push("");

	// Workspace
	const workspace = config.agents.defaults.workspace;
	const wsPath = workspace.startsWith("~") ? resolve(homedir(), workspace.slice(2)) : workspace;
	lines.push("Workspace:");
	lines.push(`  Path:   ${wsPath}`);
	lines.push(`  Exists: ${existsSync(wsPath) ? "yes" : "no"}`);
	lines.push("");

	// Agent Defaults
	const agent = config.agents.defaults;
	lines.push("Agent Defaults:");
	lines.push(`  Model:             ${agent.model}`);
	lines.push(`  Max Tokens:        ${agent.maxTokens}`);
	lines.push(`  Temperature:       ${agent.temperature}`);
	lines.push(`  Max Tool Iterations: ${agent.maxToolIterations}`);
	lines.push("");

	// Providers
	lines.push("Providers:");
	const providers = config.providers;
	lines.push(`  Anthropic:   ${maskKey(providers.anthropic.apiKey)}`);
	lines.push(`  OpenAI:      ${maskKey(providers.openai.apiKey)}`);
	lines.push(`  OpenRouter:  ${maskKey(providers.openrouter.apiKey)}`);
	lines.push("");

	// Channels
	lines.push("Channels:");
	lines.push(`  Telegram:  ${config.channels.telegram.enabled ? "enabled" : "disabled"}`);
	lines.push(`  WhatsApp:  ${config.channels.whatsapp.enabled ? "enabled" : "disabled"}`);
	lines.push(`  Discord:   ${config.channels.discord.enabled ? "enabled" : "disabled"}`);
	lines.push("");

	// Web Tools
	lines.push("Web Tools:");
	lines.push(`  Brave Search: ${maskKey(config.tools.web.search.apiKey)}`);
	lines.push(`  Firecrawl:    ${maskKey(config.tools.web.firecrawl.apiKey)}`);
	lines.push("");

	// Session DB
	const dbPath = config.session.dbPath;
	const resolvedDb = dbPath.startsWith("~") ? resolve(homedir(), dbPath.slice(2)) : dbPath;
	lines.push("Session DB:");
	lines.push(`  Path:   ${resolvedDb}`);
	lines.push(`  Exists: ${existsSync(resolvedDb) ? "yes" : "no"}`);
	lines.push("");

	return lines.join("\n");
}

export function registerStatus(cmd: Command): void {
	cmd
		.command("status")
		.description("Show configuration and system status")
		.action(() => {
			const configPath = resolve(homedir(), ".featherbot", "config.json");
			const config = loadConfig();
			console.log(formatStatus(config, configPath));
		});
}
