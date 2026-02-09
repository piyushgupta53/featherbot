import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
	FeatherBotConfigSchema,
	MODEL_CHOICES,
	detectProvider,
	validateApiKeyFormat,
} from "@featherbot/core";
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

		// Step 1: Ask for API key first (auto-detect provider from prefix)
		const apiKey = await rl.question("Paste your API key: ");
		const trimmedKey = apiKey.trim();

		// Step 2: Auto-detect provider
		const { provider: detected } = detectProvider(trimmedKey);
		let provider: ProviderChoice;

		if (detected) {
			const confirm = await rl.question(`Detected ${detected} — correct? (Y/n) `);
			if (confirm.trim().toLowerCase() === "n") {
				provider = await askProvider(rl, output);
			} else {
				provider = detected;
			}
		} else {
			output.write("Could not detect provider from key prefix.\n");
			provider = await askProvider(rl, output);
		}

		// Step 3: Format validation
		const validation = validateApiKeyFormat(provider, trimmedKey);
		if (!validation.valid) {
			output.write(`Warning: ${validation.error}\n`);
		}

		// Step 4: Choose model
		const choices = MODEL_CHOICES[provider];
		const defaultModel = {
			id: choices[0]?.id ?? "",
			label: choices[0]?.label ?? "",
			description: "",
		};
		output.write("\nChoose a model (enter a number):\n");
		for (const [i, choice] of choices.entries()) {
			output.write(`  ${i + 1}. ${choice.label} — ${choice.description}\n`);
		}
		const modelAnswer = await rl.question(`Enter 1-${choices.length} [1]: `);
		const modelIndex = Number.parseInt(modelAnswer.trim(), 10);
		const selectedModel =
			(modelIndex >= 1 && modelIndex <= choices.length ? choices[modelIndex - 1] : undefined) ??
			defaultModel;

		// Step 5: Telegram setup
		let telegramEnabled = false;
		let telegramToken = "";
		const telegramAnswer = await rl.question("Enable Telegram? (y/N) ");
		if (telegramAnswer.trim().toLowerCase() === "y") {
			telegramEnabled = true;
			telegramToken = (await rl.question("Telegram bot token: ")).trim();
		}

		// Step 6: WhatsApp setup
		let whatsappEnabled = false;
		const whatsappAnswer = await rl.question("Enable WhatsApp? (y/N) ");
		if (whatsappAnswer.trim().toLowerCase() === "y") {
			whatsappEnabled = true;
		}

		// Step 7: Web search (Brave API)
		let braveApiKey = "";
		output.write("\nWeb search lets your agent look things up online (uses Brave Search).\n");
		output.write("Get a free API key at https://brave.com/search/api/\n");
		const braveAnswer = await rl.question("Brave Search API key (Enter to skip): ");
		braveApiKey = braveAnswer.trim();

		// Step 8: Voice transcription (only if a messaging channel is enabled)
		let transcriptionEnabled = false;
		let transcriptionProvider: "groq" | "openai" = "groq";
		let transcriptionApiKey = "";
		if (telegramEnabled || whatsappEnabled) {
			output.write("\nVoice transcription lets your agent understand voice messages.\n");
			output.write("Uses Whisper via Groq (free tier available) or OpenAI.\n");
			const transcribeAnswer = await rl.question("Enable voice transcription? (y/N) ");
			if (transcribeAnswer.trim().toLowerCase() === "y") {
				transcriptionEnabled = true;
				output.write("Choose transcription provider:\n");
				output.write("  1. Groq (faster, free tier)\n");
				output.write("  2. OpenAI\n");
				const providerAnswer = await rl.question("Provider [1]: ");
				if (providerAnswer.trim() === "2") {
					transcriptionProvider = "openai";
				}
				transcriptionApiKey = (
					await rl.question(`${transcriptionProvider === "groq" ? "Groq" : "OpenAI"} API key: `)
				).trim();
			}
		}

		// Build config
		const config = FeatherBotConfigSchema.parse({
			providers: {
				[provider]: { apiKey: trimmedKey },
			},
			agents: {
				defaults: {
					model: selectedModel.id,
				},
			},
			channels: {
				telegram: {
					enabled: telegramEnabled,
					token: telegramToken,
				},
				whatsapp: {
					enabled: whatsappEnabled,
				},
			},
			tools: {
				web: {
					search: {
						apiKey: braveApiKey,
					},
				},
			},
			transcription: {
				enabled: transcriptionEnabled,
				provider: transcriptionProvider,
				apiKey: transcriptionApiKey,
			},
		});

		mkdirSync(configDir, { recursive: true });
		writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

		mkdirSync(resolve(workspaceDir, "memory"), { recursive: true });
		cpSync(templateDir, workspaceDir, { recursive: true });

		output.write("\nSetup complete!\n\n");
		output.write(`  Config:    ${configPath}\n`);
		output.write(`  Workspace: ${workspaceDir}\n`);
		output.write(`  Provider:  ${provider}\n`);
		output.write(`  Model:     ${selectedModel.label}\n\n`);
		output.write("Next steps:\n");
		output.write("  featherbot start    Start the agent\n");
		output.write("  featherbot status   Check your setup\n");
		if (whatsappEnabled) {
			output.write("  featherbot whatsapp login   Pair your WhatsApp device\n");
		}
		output.write("\n");
	} finally {
		rl.close();
	}
}

async function askProvider(
	rl: readline.Interface,
	output: NodeJS.WritableStream,
): Promise<ProviderChoice> {
	output.write("Choose your LLM provider:\n");
	output.write("  1. Anthropic\n");
	output.write("  2. OpenAI\n");
	output.write("  3. OpenRouter\n");
	const answer = await rl.question("Provider [1]: ");
	const index = Number.parseInt(answer.trim(), 10);
	if (index === 2) return "openai";
	if (index === 3) return "openrouter";
	return "anthropic";
}

function resolveTemplateDir(): string {
	const currentFile = fileURLToPath(import.meta.url);
	const currentDir = dirname(currentFile);
	const candidates = [
		resolve(currentDir, "..", "..", "..", "..", "workspace"), // from src/commands/
		resolve(currentDir, "..", "..", "..", "workspace"), // from dist/ (built)
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
