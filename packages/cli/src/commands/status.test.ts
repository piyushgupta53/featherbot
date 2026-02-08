import { FeatherBotConfigSchema } from "@featherbot/core";
import { describe, expect, it } from "vitest";
import { formatStatus, maskKey } from "./status.js";

describe("maskKey", () => {
	it("returns 'not configured' for empty string", () => {
		expect(maskKey("")).toBe("not configured");
	});

	it("returns **** for short keys", () => {
		expect(maskKey("abc")).toBe("****");
		expect(maskKey("1234567")).toBe("****");
	});

	it("masks keys with first 4 and last 4 chars", () => {
		expect(maskKey("sk-ant-abc123xyz789")).toBe("sk-a...z789");
	});

	it("masks exactly 8-char key", () => {
		expect(maskKey("12345678")).toBe("1234...5678");
	});
});

describe("formatStatus", () => {
	it("shows all sections with full config", () => {
		const config = FeatherBotConfigSchema.parse({
			providers: {
				anthropic: { apiKey: "sk-ant-test-key-1234" },
			},
			channels: {
				telegram: { enabled: true },
			},
		});
		const output = formatStatus(config, "/tmp/test-config.json");

		expect(output).toContain("FeatherBot Status");
		expect(output).toContain("Config:");
		expect(output).toContain("/tmp/test-config.json");
		expect(output).toContain("Workspace:");
		expect(output).toContain("Agent Defaults:");
		expect(output).toContain("anthropic/claude-sonnet-4-5-20250929");
		expect(output).toContain("8192");
		expect(output).toContain("0.7");
		expect(output).toContain("20");
		expect(output).toContain("Providers:");
		expect(output).toContain("sk-a...1234");
		expect(output).toContain("Channels:");
		expect(output).toContain("Telegram:  enabled");
		expect(output).toContain("WhatsApp:  disabled");
		expect(output).toContain("Discord:   disabled");
		expect(output).toContain("Session DB:");
	});

	it("shows defaults when config has no API keys", () => {
		const config = FeatherBotConfigSchema.parse({});
		const output = formatStatus(config, "/nonexistent/config.json");

		expect(output).toContain("not configured");
		expect(output).toContain("Telegram:  disabled");
		expect(output).toContain("Exists: no");
	});

	it("never shows full API keys", () => {
		const key = "sk-ant-super-secret-key-value-1234";
		const config = FeatherBotConfigSchema.parse({
			providers: {
				anthropic: { apiKey: key },
				openai: { apiKey: "sk-openai-test-key-5678" },
				openrouter: { apiKey: "sk-or-key-9abc" },
			},
		});
		const output = formatStatus(config, "/tmp/config.json");

		expect(output).not.toContain(key);
		expect(output).not.toContain("sk-openai-test-key-5678");
		expect(output).not.toContain("sk-or-key-9abc");
		expect(output).toContain("sk-a...1234");
		expect(output).toContain("sk-o...5678");
		expect(output).toContain("sk-o...9abc");
	});
});
