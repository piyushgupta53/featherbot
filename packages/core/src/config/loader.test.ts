import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./loader.js";

describe("loadConfig", () => {
	const testDir = join(tmpdir(), "featherbot-test-config");
	const testConfigPath = join(testDir, "config.json");

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("FEATHERBOT_") && key !== "FEATHERBOT_CONFIG") {
				delete process.env[key];
			}
		}
	});

	it("returns full defaults when no config file exists", () => {
		const config = loadConfig(join(testDir, "nonexistent.json"));
		expect(config.agents.defaults.model).toBe("anthropic/claude-sonnet-4-5-20250929");
		expect(config.agents.defaults.maxTokens).toBe(8192);
		expect(config.agents.defaults.temperature).toBe(0.7);
		expect(config.channels.telegram.enabled).toBe(false);
		expect(config.providers.anthropic.apiKey).toBe("");
		expect(config.tools.restrictToWorkspace).toBe(false);
	});

	it("loads config from a JSON file", () => {
		writeFileSync(
			testConfigPath,
			JSON.stringify({
				agents: { defaults: { model: "openai/gpt-4o", maxTokens: 4096 } },
			}),
		);
		const config = loadConfig(testConfigPath);
		expect(config.agents.defaults.model).toBe("openai/gpt-4o");
		expect(config.agents.defaults.maxTokens).toBe(4096);
		expect(config.agents.defaults.temperature).toBe(0.7);
	});

	it("applies environment variable overrides", () => {
		writeFileSync(testConfigPath, JSON.stringify({}));
		process.env.FEATHERBOT_agents__defaults__model = "custom/model";
		process.env.FEATHERBOT_agents__defaults__maxTokens = "2048";
		process.env.FEATHERBOT_channels__telegram__enabled = "true";

		const config = loadConfig(testConfigPath);
		expect(config.agents.defaults.model).toBe("custom/model");
		expect(config.agents.defaults.maxTokens).toBe(2048);
		expect(config.channels.telegram.enabled).toBe(true);
	});

	it("env vars override file values", () => {
		writeFileSync(
			testConfigPath,
			JSON.stringify({
				agents: { defaults: { model: "from-file" } },
			}),
		);
		process.env.FEATHERBOT_agents__defaults__model = "from-env";

		const config = loadConfig(testConfigPath);
		expect(config.agents.defaults.model).toBe("from-env");
	});

	it("falls back to defaults on invalid config with warning", () => {
		writeFileSync(
			testConfigPath,
			JSON.stringify({
				agents: { defaults: { maxTokens: -1 } },
			}),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const config = loadConfig(testConfigPath);
		expect(warnSpy).toHaveBeenCalledWith(
			"[featherbot] Invalid config, using defaults:",
			expect.any(String),
		);
		expect(config.agents.defaults.maxTokens).toBe(8192);

		warnSpy.mockRestore();
	});

	it("handles malformed JSON gracefully", () => {
		writeFileSync(testConfigPath, "not valid json{{{");
		const config = loadConfig(testConfigPath);
		expect(config.agents.defaults.model).toBe("anthropic/claude-sonnet-4-5-20250929");
	});
});
