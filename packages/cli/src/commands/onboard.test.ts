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

	it("creates config file with chosen provider and API key", async () => {
		const { input, output } = createStreams(["1", "sk-test-key-123"]);
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
		expect(config.providers.anthropic.apiKey).toBe("sk-test-key-123");
	});

	it("creates workspace directory with template files", async () => {
		const { input, output } = createStreams(["1", "sk-test-key"]);
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

	it("selects OpenAI when user enters 2", async () => {
		const { input, output } = createStreams(["2", "sk-openai-key"]);
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

	it("prints success message with next steps", async () => {
		const { input, output, getOutput } = createStreams(["1", "key"]);

		await runOnboard({
			configDir: join(testDir, "config"),
			workspaceDir: join(testDir, "workspace"),
			templateDir: resolve(process.cwd(), "..", "..", "workspace"),
			input,
			output,
		});

		const out = getOutput();
		expect(out).toContain("Setup complete!");
		expect(out).toContain("featherbot agent");
		expect(out).toContain("featherbot status");
	});
});
