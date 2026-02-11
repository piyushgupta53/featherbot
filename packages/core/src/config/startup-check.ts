import { parseModelString } from "../provider/model-resolver.js";
import type { FeatherBotConfig } from "./schema.js";

export interface StartupCheckResult {
	ready: boolean;
	errors: string[];
	warnings: string[];
}

export function checkStartupConfig(config: FeatherBotConfig): StartupCheckResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	const modelString = config.agents.defaults.model;
	const { providerName } = parseModelString(modelString);
	const apiKey = config.providers[providerName].apiKey;

	if (!apiKey) {
		errors.push(
			`No API key configured for provider "${providerName}" (model: ${modelString}). Run \`featherbot onboard\` to set up.`,
		);
	}

	if (config.channels.telegram.enabled && !config.channels.telegram.token) {
		errors.push(
			"Telegram is enabled but no bot token is set. Add channels.telegram.token to your config.",
		);
	}

	if (config.channels.whatsapp.enabled) {
		warnings.push(
			"WhatsApp is enabled. Make sure you've paired your device with `featherbot whatsapp login`.",
		);
	}

	if (
		config.heartbeat.enabled &&
		(!config.heartbeat.notifyChannel || !config.heartbeat.notifyChatId)
	) {
		warnings.push(
			"Heartbeat notifications are not fully configured (notifyChannel/notifyChatId missing). Proactive messages will only work after a chat route is discovered.",
		);
	}

	return {
		ready: errors.length === 0,
		errors,
		warnings,
	};
}
