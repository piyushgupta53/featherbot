import { describe, expect, it, vi } from "vitest";

vi.mock("@featherbot/core", () => ({
	createMemoryStore: vi.fn(() => ({
		getMemoryContext: vi.fn().mockResolvedValue(""),
		getRecentMemories: vi.fn().mockResolvedValue(""),
		getMemoryFilePath: vi.fn().mockReturnValue(""),
		getDailyNotePath: vi.fn().mockReturnValue(""),
		readMemoryFile: vi.fn().mockResolvedValue(""),
		writeMemoryFile: vi.fn().mockResolvedValue(undefined),
		readDailyNote: vi.fn().mockResolvedValue(""),
		writeDailyNote: vi.fn().mockResolvedValue(undefined),
		deleteDailyNote: vi.fn().mockResolvedValue(undefined),
		listDailyNotes: vi.fn().mockResolvedValue([]),
	})),
	createSkillsLoader: vi.fn(() => ({
		getAlwaysLoadedSkills: vi.fn().mockReturnValue([]),
		buildSummary: vi.fn().mockReturnValue(""),
	})),
	loadConfig: vi.fn(() => ({
		agents: {
			defaults: {
				workspace: "~/.featherbot/workspace",
				model: "anthropic/claude-sonnet-4-5-20250929",
				maxTokens: 8192,
				temperature: 0.7,
				maxToolIterations: 20,
				messageTimeoutMs: 300000,
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
			web: { search: { apiKey: "", maxResults: 5 } },
			exec: { timeout: 60 },
			restrictToWorkspace: false,
		},
		session: { dbPath: "", maxMessages: 50 },
	})),
	checkStartupConfig: vi.fn(() => ({ ready: true, errors: [], warnings: [] })),
	createAgentLoop: vi.fn(() => ({
		processDirect: vi.fn().mockResolvedValue({
			text: "The answer is 4",
			usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
			steps: 1,
			finishReason: "stop",
			toolCalls: [],
			toolResults: [],
		}),
	})),
}));

import { createAgentLoop } from "@featherbot/core";
import { runSingleShot } from "./agent.js";

describe("runSingleShot", () => {
	it("calls processDirect with correct message and session key", async () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await runSingleShot("What is 2+2?");

		const mockAgentLoop = vi.mocked(createAgentLoop).mock.results[0]?.value;
		expect(mockAgentLoop.processDirect).toHaveBeenCalledWith("What is 2+2?", {
			sessionKey: "cli:direct",
		});

		writeSpy.mockRestore();
	});

	it("writes response text to stdout", async () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await runSingleShot("test message");

		expect(writeSpy).toHaveBeenCalledWith("The answer is 4");

		writeSpy.mockRestore();
	});

	it("throws on agent error", async () => {
		const { createAgentLoop: mockCreate } = await import("@featherbot/core");
		vi.mocked(mockCreate).mockReturnValueOnce({
			processDirect: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
			processMessage: vi.fn(),
		} as unknown as ReturnType<typeof mockCreate>);

		await expect(runSingleShot("fail")).rejects.toThrow("LLM unavailable");
	});
});
