import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { type FeatherBotConfig, FeatherBotConfigSchema } from "./schema.js";

const DEFAULT_CONFIG_PATH = resolve(homedir(), ".featherbot", "config.json");
const ENV_PREFIX = "FEATHERBOT_";
const ENV_DELIMITER = "__";

function readConfigFile(path: string): Record<string, unknown> {
	try {
		const content = readFileSync(path, "utf-8");
		return JSON.parse(content) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function setNestedValue(obj: Record<string, unknown>, keys: string[], value: string): void {
	let current = obj;
	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i];
		if (key === undefined) continue;
		if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
			current[key] = {};
		}
		current = current[key] as Record<string, unknown>;
	}
	const lastKey = keys[keys.length - 1];
	if (lastKey === undefined) return;

	if (value === "true") {
		current[lastKey] = true;
	} else if (value === "false") {
		current[lastKey] = false;
	} else if (value !== "" && !Number.isNaN(Number(value))) {
		current[lastKey] = Number(value);
	} else {
		current[lastKey] = value;
	}
}

function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith(ENV_PREFIX) && value !== undefined) {
			const path = key.slice(ENV_PREFIX.length).split(ENV_DELIMITER);
			setNestedValue(config, path, value);
		}
	}
	return config;
}

export function loadConfig(configPath?: string): FeatherBotConfig {
	const filePath = configPath ?? process.env.FEATHERBOT_CONFIG ?? DEFAULT_CONFIG_PATH;
	const fileConfig = readConfigFile(filePath);
	const merged = applyEnvOverrides(fileConfig);

	const result = FeatherBotConfigSchema.safeParse(merged);
	if (result.success) {
		return result.data;
	}

	console.warn(
		"[featherbot] Invalid config, using defaults:",
		result.error.issues.map((i) => i.message).join(", "),
	);
	return FeatherBotConfigSchema.parse({});
}
