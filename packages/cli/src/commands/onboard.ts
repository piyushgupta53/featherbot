import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { FeatherBotConfigSchema } from "@featherbot/core";
import type { Command } from "commander";

const PROVIDERS = ["anthropic", "openai", "openrouter"] as const;
type ProviderChoice = (typeof PROVIDERS)[number];

export interface OnboardOptions {
	configDir?: string;
	workspaceDir?: string;
	templateDir?: string;
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
}

export async function runOnboard(options: OnboardOptions = {}): Promise<void> {
	const configDir = options.configDir ?? resolve(homedir(), ".featherbot");
	const configPath = resolve(configDir, "config.json");
	const workspaceDir = options.workspaceDir ?? resolve(configDir, "workspace");
	const templateDir = options.templateDir ?? resolveTemplateDir();
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;

	const rl = readline.createInterface({ input, output });

	try {
		output.write("\nWelcome to FeatherBot!\n");
		output.write("Let's set up your agent.\n\n");

		if (existsSync(configPath)) {
			const answer = await rl.question("Config file already exists. Overwrite? (y/N) ");
			if (answer.trim().toLowerCase() !== "y") {
				output.write("Setup cancelled. Existing config preserved.\n");
				return;
			}
		}

		output.write("Choose your LLM provider:\n");
		output.write("  1. Anthropic (default)\n");
		output.write("  2. OpenAI\n");
		output.write("  3. OpenRouter\n");
		const providerAnswer = await rl.question("Provider [1]: ");
		const providerIndex = Number.parseInt(providerAnswer.trim(), 10);
		let provider: ProviderChoice = "anthropic";
		if (providerIndex === 2) provider = "openai";
		else if (providerIndex === 3) provider = "openrouter";

		const apiKey = await rl.question(`Enter your ${provider} API key: `);

		const config = FeatherBotConfigSchema.parse({
			providers: {
				[provider]: { apiKey: apiKey.trim() },
			},
		});

		mkdirSync(configDir, { recursive: true });
		writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

		mkdirSync(resolve(workspaceDir, "memory"), { recursive: true });
		cpSync(templateDir, workspaceDir, { recursive: true });

		output.write("\nSetup complete!\n\n");
		output.write(`  Config:    ${configPath}\n`);
		output.write(`  Workspace: ${workspaceDir}\n\n`);
		output.write("Next steps:\n");
		output.write("  featherbot agent    Start chatting\n");
		output.write("  featherbot status   Check your setup\n\n");
	} finally {
		rl.close();
	}
}

function resolveTemplateDir(): string {
	const currentFile = fileURLToPath(import.meta.url);
	const currentDir = dirname(currentFile);
	const candidates = [
		resolve(currentDir, "..", "..", "..", "..", "workspace"),
		resolve(currentDir, "..", "..", "workspace"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return candidates[0] ?? resolve(currentDir, "..", "..", "..", "..", "workspace");
}

export function registerOnboard(cmd: Command): void {
	cmd
		.command("onboard")
		.description("Interactive setup wizard — create config and workspace")
		.action(async () => {
			await runOnboard();
		});
}
