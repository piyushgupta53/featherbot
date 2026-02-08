import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOnboard } from "./onboard.js";

function createStreams(lines: string[]) {
	const input = new PassThrough();
	const output = new PassThrough();
	const chunks: Uint8Array[] = [];
	output.on("data", (chunk: Uint8Array) => chunks.push(chunk));

	// Feed lines with a small delay so readline can consume them one at a time
	let index = 0;
	const feedNext = () => {
		if (index < lines.length) {
			input.write(`${lines[index]}\n`);
			index++;
		}
		if (index >= lines.length) {
			input.end();
		}
	};

	// Feed one line each time output writes (i.e., when readline prompts)
	output.on("data", () => {
		setTimeout(feedNext, 5);
	});

	// Kick off the first line after a small delay
	setTimeout(feedNext, 10);

	return {
		input: input as unknown as NodeJS.ReadableStream,
		output: output as unknown as NodeJS.WritableStream,
		getOutput: () => Buffer.concat(chunks).toString(),
	};
}

describe("runOnboard", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = resolve(tmpdir(), `featherbot-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	// Flow: apiKey → confirm detection → model → telegram → whatsapp → brave key
	it("creates config with auto-detected anthropic provider", async () => {
		const { input, output } = createStreams(["sk-ant-test-key-123", "y", "1", "n", "n", ""]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const configPath = join(configDir, "config.json");
		expect(existsSync(configPath)).toBe(true);

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config.providers.anthropic.apiKey).toBe("sk-ant-test-key-123");
	});

	it("creates workspace directory with template files", async () => {
		const { input, output } = createStreams(["sk-ant-test-key", "y", "1", "n", "n", ""]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		expect(existsSync(join(workspaceDir, "AGENTS.md"))).toBe(true);
		expect(existsSync(join(workspaceDir, "SOUL.md"))).toBe(true);
		expect(existsSync(join(workspaceDir, "USER.md"))).toBe(true);
		expect(existsSync(join(workspaceDir, "TOOLS.md"))).toBe(true);
		expect(existsSync(join(workspaceDir, "memory", "MEMORY.md"))).toBe(true);
	});

	it("auto-detects openai from sk- prefix", async () => {
		const { input, output } = createStreams(["sk-openai-key", "y", "1", "n", "n", ""]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
		expect(config.providers.openai.apiKey).toBe("sk-openai-key");
	});

	it("allows override when detection is wrong", async () => {
		const { input, output } = createStreams(["sk-key", "n", "1", "1", "n", "n", ""]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
		expect(config.providers.anthropic.apiKey).toBe("sk-key");
	});

	it("falls back to provider menu for unrecognized key", async () => {
		const { input, output } = createStreams(["unknown-key", "2", "1", "n", "n", ""]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
		expect(config.providers.openai.apiKey).toBe("unknown-key");
	});

	it("skips when user declines overwrite", async () => {
		const configDir = join(testDir, "config");
		mkdirSync(configDir, { recursive: true });
		const configPath = join(configDir, "config.json");
		const original = '{"original": true}';
		writeFileSync(configPath, original);

		const { input, output, getOutput } = createStreams(["n"]);

		await runOnboard({
			configDir,
			workspaceDir: join(testDir, "workspace"),
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		expect(readFileSync(configPath, "utf-8")).toBe(original);
		expect(getOutput()).toContain("Setup cancelled");
	});

	it("sets model from user selection", async () => {
		const { input, output } = createStreams(["sk-ant-key", "y", "2", "n", "n", ""]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
		expect(config.agents.defaults.model).toContain("haiku");
	});

	it("enables telegram when user says yes", async () => {
		const { input, output } = createStreams(["sk-ant-key", "y", "1", "y", "123:ABC", "n", ""]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
		expect(config.channels.telegram.enabled).toBe(true);
		expect(config.channels.telegram.token).toBe("123:ABC");
	});

	it("enables whatsapp and shows login reminder", async () => {
		const { input, output, getOutput } = createStreams(["sk-ant-key", "y", "1", "n", "y", ""]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
		expect(config.channels.whatsapp.enabled).toBe(true);
		expect(getOutput()).toContain("featherbot whatsapp login");
	});

	it("saves brave search API key when provided", async () => {
		const { input, output } = createStreams(["sk-ant-key", "y", "1", "n", "n", "BSA-test-key"]);
		const configDir = join(testDir, "config");
		const workspaceDir = join(testDir, "workspace");

		await runOnboard({
			configDir,
			workspaceDir,
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
		expect(config.tools.web.search.apiKey).toBe("BSA-test-key");
	});

	it("prints success message with next steps", async () => {
		const { input, output, getOutput } = createStreams(["sk-ant-key", "y", "1", "n", "n", ""]);

		await runOnboard({
			configDir: join(testDir, "config"),
			workspaceDir: join(testDir, "workspace"),
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const out = getOutput();
		expect(out).toContain("Setup complete!");
		expect(out).toContain("featherbot start");
		expect(out).toContain("featherbot status");
	});
});
