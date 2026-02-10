import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runOnboard: vi.fn().mockResolvedValue(undefined),
	runRepl: vi.fn().mockResolvedValue(undefined),
	runGateway: vi.fn().mockResolvedValue(undefined),
	existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock("./onboard.js", () => ({
	runOnboard: mocks.runOnboard,
}));

vi.mock("./agent.js", () => ({
	runRepl: mocks.runRepl,
}));

vi.mock("./gateway.js", () => ({
	runGateway: mocks.runGateway,
}));

vi.mock("@featherbot/core", () => ({
	loadConfig: vi.fn(() => ({
		agents: {
			defaults: {
				workspace: "~/.featherbot/workspace",
				model: "anthropic/claude-sonnet-4-5-20250929",
				maxTokens: 8192,
				temperature: 0.7,
				maxToolIterations: 20,
				bootstrapFiles: [],
			},
		},
		channels: {
			telegram: { enabled: false, token: "", allowFrom: [] },
			whatsapp: { enabled: false, allowFrom: [], authDir: "~/.featherbot/whatsapp-auth" },
			discord: { enabled: false, token: "" },
		},
		providers: {
			anthropic: { apiKey: "sk-ant-test" },
			openai: { apiKey: "" },
			openrouter: { apiKey: "" },
		},
		tools: {
			web: {
				search: { apiKey: "", maxResults: 5 },
				fetch: { maxContentLength: 50000, timeoutMs: 30000 },
			},
			exec: { timeout: 60 },
			restrictToWorkspace: false,
		},
		session: { dbPath: "", maxMessages: 50 },
		cron: { enabled: false, storePath: "" },
		heartbeat: { enabled: false, intervalMs: 600000, heartbeatFile: "HEARTBEAT.md" },
		subagent: { maxIterations: 15, timeoutMs: 300000 },
	})),
	checkStartupConfig: vi.fn(() => ({ ready: true, errors: [], warnings: [] })),
}));

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: mocks.existsSync,
	};
});

import { runStart } from "./start.js";

describe("runStart", () => {
	it("runs REPL when no channels are enabled", async () => {
		await runStart();

		expect(mocks.runRepl).toHaveBeenCalled();
		expect(mocks.runGateway).not.toHaveBeenCalled();
	});

	it("runs onboard when config does not exist", async () => {
		mocks.existsSync.mockReturnValueOnce(false);

		await runStart();

		expect(mocks.runOnboard).toHaveBeenCalled();
	});

	it("does not run onboard when config exists", async () => {
		mocks.runOnboard.mockClear();
		mocks.existsSync.mockReturnValueOnce(true);

		await runStart();

		expect(mocks.runOnboard).not.toHaveBeenCalled();
	});
});
