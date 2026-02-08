import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { platform } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillsLoader } from "../skills/loader.js";
import { ContextBuilder } from "./context-builder.js";
import type {
	ContextBuilderOptions,
	ContextBuilderResult,
	SessionContext,
} from "./context-builder.js";

describe("ContextBuilder", () => {
	const defaultOptions: ContextBuilderOptions = {
		workspacePath: "/tmp/test-workspace",
		bootstrapFiles: ["AGENTS.md", "SOUL.md"],
		agentName: "FeatherBot",
	};

	let tempDir: string | undefined;

	async function makeTempWorkspace(): Promise<string> {
		const raw = await mkdtemp(join(tmpdir(), "ctx-test-"));
		tempDir = await realpath(raw);
		return tempDir;
	}

	afterEach(() => {
		tempDir = undefined;
	});

	it("constructs with required options", () => {
		const builder = new ContextBuilder(defaultOptions);
		expect(builder).toBeInstanceOf(ContextBuilder);
	});

	it("constructs with optional memoryStore", () => {
		const mockMemoryStore = {
			getMemoryContext: async () => "",
			getRecentMemories: async () => "",
			getMemoryFilePath: () => "/tmp/memory/MEMORY.md",
			getDailyNotePath: () => "/tmp/memory/2026-02-07.md",
		};
		const builder = new ContextBuilder({
			...defaultOptions,
			memoryStore: mockMemoryStore,
		});
		expect(builder).toBeInstanceOf(ContextBuilder);
	});

	it("build() returns a ContextBuilderResult with systemPrompt", async () => {
		const builder = new ContextBuilder(defaultOptions);
		const result: ContextBuilderResult = await builder.build();
		expect(result).toHaveProperty("systemPrompt");
		expect(typeof result.systemPrompt).toBe("string");
	});

	it("build() accepts an optional SessionContext", async () => {
		const builder = new ContextBuilder(defaultOptions);
		const session: SessionContext = {
			channelName: "telegram",
			chatId: "12345",
		};
		const result = await builder.build(session);
		expect(result).toHaveProperty("systemPrompt");
	});

	it("build() works with partial SessionContext", async () => {
		const builder = new ContextBuilder(defaultOptions);
		const result = await builder.build({ channelName: "terminal" });
		expect(result).toHaveProperty("systemPrompt");
	});

	describe("identity block", () => {
		it("includes agent name, timestamp, node version, platform, and workspace", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## Identity");
			expect(systemPrompt).toContain("Name: FeatherBot");
			expect(systemPrompt).toContain(`Node.js: ${process.version}`);
			expect(systemPrompt).toContain(`Platform: ${platform()}`);
			expect(systemPrompt).toContain("Workspace: /tmp/test-workspace");
			expect(systemPrompt).toContain("Timestamp:");
		});

		it("uses custom agent name", async () => {
			const builder = new ContextBuilder({
				...defaultOptions,
				agentName: "MyBot",
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("Name: MyBot");
			expect(systemPrompt).not.toContain("Name: FeatherBot");
		});

		it("identity block is the first section in the prompt", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build();
			expect(systemPrompt.startsWith("## Identity")).toBe(true);
		});

		it("timestamp is a valid ISO string", async () => {
			const before = new Date().toISOString();
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build();
			const after = new Date().toISOString();
			const match = systemPrompt.match(/Timestamp: (.+)/);
			expect(match).not.toBeNull();
			const timestamp = match?.[1] ?? "";
			expect(timestamp >= before).toBe(true);
			expect(timestamp <= after).toBe(true);
		});
	});

	describe("bootstrap file loading", () => {
		it("loads all bootstrap files present in workspace", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "AGENTS.md"), "Be helpful");
			await writeFile(join(ws, "SOUL.md"), "Be kind");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["AGENTS.md", "SOUL.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## AGENTS.md\nBe helpful");
			expect(systemPrompt).toContain("## SOUL.md\nBe kind");
		});

		it("silently skips missing files", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "AGENTS.md"), "Be helpful");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["AGENTS.md", "MISSING.md", "SOUL.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## AGENTS.md\nBe helpful");
			expect(systemPrompt).not.toContain("MISSING.md");
			expect(systemPrompt).not.toContain("SOUL.md");
		});

		it("returns only identity when all bootstrap files are missing", async () => {
			const ws = await makeTempWorkspace();
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["AGENTS.md", "SOUL.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## Identity");
			expect(systemPrompt).not.toContain("## AGENTS.md");
			expect(systemPrompt).not.toContain("## SOUL.md");
		});

		it("skips empty and whitespace-only files", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "AGENTS.md"), "");
			await writeFile(join(ws, "SOUL.md"), "   \n\t  \n");
			await writeFile(join(ws, "USER.md"), "Real content");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["AGENTS.md", "SOUL.md", "USER.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## AGENTS.md");
			expect(systemPrompt).not.toContain("## SOUL.md");
			expect(systemPrompt).toContain("## USER.md\nReal content");
		});

		it("loads files in the order specified in config", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "B.md"), "Second");
			await writeFile(join(ws, "A.md"), "First");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["A.md", "B.md"],
			});
			const { systemPrompt } = await builder.build();
			const indexA = systemPrompt.indexOf("## A.md");
			const indexB = systemPrompt.indexOf("## B.md");
			expect(indexA).toBeLessThan(indexB);
		});

		it("supports custom file list", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "CUSTOM.md"), "Custom instructions");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["CUSTOM.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## CUSTOM.md\nCustom instructions");
		});
	});

	describe("session context", () => {
		it("includes session section with channel and chat ID when both are provided", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build({
				channelName: "telegram",
				chatId: "12345",
			});
			expect(systemPrompt).toContain("## Session");
			expect(systemPrompt).toContain("Channel: telegram");
			expect(systemPrompt).toContain("Chat ID: 12345");
		});

		it("includes session section with only channel when chatId is missing", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build({
				channelName: "terminal",
			});
			expect(systemPrompt).toContain("## Session");
			expect(systemPrompt).toContain("Channel: terminal");
			expect(systemPrompt).not.toContain("Chat ID:");
		});

		it("includes session section with only chatId when channel is missing", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build({ chatId: "999" });
			expect(systemPrompt).toContain("## Session");
			expect(systemPrompt).toContain("Chat ID: 999");
			expect(systemPrompt).not.toContain("Channel:");
		});

		it("omits session section when sessionContext is omitted", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## Session");
		});

		it("omits session section when sessionContext has no fields set", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build({});
			expect(systemPrompt).not.toContain("## Session");
		});
	});

	describe("final assembly and section ordering", () => {
		it("assembles sections in order: Identity -> Bootstrap -> Memory -> Session", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "AGENTS.md"), "Agent instructions");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["AGENTS.md"],
				memoryStore: {
					getMemoryContext: async () => "Some memory",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build({
				channelName: "telegram",
				chatId: "12345",
			});
			const identityIdx = systemPrompt.indexOf("## Identity");
			const bootstrapIdx = systemPrompt.indexOf("## AGENTS.md");
			const memoryIdx = systemPrompt.indexOf("## Memory");
			const sessionIdx = systemPrompt.indexOf("## Session");
			expect(identityIdx).toBeGreaterThanOrEqual(0);
			expect(bootstrapIdx).toBeGreaterThan(identityIdx);
			expect(memoryIdx).toBeGreaterThan(bootstrapIdx);
			expect(sessionIdx).toBeGreaterThan(memoryIdx);
		});

		it("separates sections with double newlines", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "SOUL.md"), "Be kind");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["SOUL.md"],
			});
			const { systemPrompt } = await builder.build({
				channelName: "terminal",
			});
			const parts = systemPrompt.split("\n\n");
			expect(parts.length).toBeGreaterThanOrEqual(3);
			expect(parts[0]).toContain("## Identity");
			expect(parts[1]).toContain("## SOUL.md");
			expect(parts[2]).toContain("## Session");
		});

		it("full integration: all sections present produce expected prompt", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "AGENTS.md"), "Agent rules");
			await writeFile(join(ws, "SOUL.md"), "Personality");
			const builder = new ContextBuilder({
				workspacePath: ws,
				bootstrapFiles: ["AGENTS.md", "SOUL.md"],
				agentName: "TestBot",
				memoryStore: {
					getMemoryContext: async () => "User likes cats",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build({
				channelName: "discord",
				chatId: "guild-42",
			});
			expect(systemPrompt).toContain("## Identity");
			expect(systemPrompt).toContain("Name: TestBot");
			expect(systemPrompt).toContain("## AGENTS.md\nAgent rules");
			expect(systemPrompt).toContain("## SOUL.md\nPersonality");
			expect(systemPrompt).toContain("## Memory\nUser likes cats");
			expect(systemPrompt).toContain("## Session\nChannel: discord\nChat ID: guild-42");
		});
	});

	describe("memory context", () => {
		it("includes memory context when memoryStore returns content", async () => {
			const builder = new ContextBuilder({
				...defaultOptions,
				memoryStore: {
					getMemoryContext: async () => "Remember: user prefers dark mode",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## Memory\nRemember: user prefers dark mode");
		});

		it("omits memory section when memoryStore returns empty string", async () => {
			const builder = new ContextBuilder({
				...defaultOptions,
				memoryStore: {
					getMemoryContext: async () => "",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## Memory");
		});

		it("omits memory section when no memoryStore is provided", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## Memory");
		});
	});

	describe("memory management instructions", () => {
		it("includes memory management section when memoryStore has content", async () => {
			const builder = new ContextBuilder({
				...defaultOptions,
				memoryStore: {
					getMemoryContext: async () => "Some facts",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## Memory Management");
			expect(systemPrompt).toContain("Facts");
			expect(systemPrompt).toContain("Observed Patterns");
			expect(systemPrompt).toContain("Pending");
		});

		it("omits memory management section when memoryStore returns empty", async () => {
			const builder = new ContextBuilder({
				...defaultOptions,
				memoryStore: {
					getMemoryContext: async () => "",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## Memory Management");
		});

		it("omits memory management section when no memoryStore is provided", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## Memory Management");
		});

		it("memory management appears right after memory section", async () => {
			const ws = await makeTempWorkspace();
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				memoryStore: {
					getMemoryContext: async () => "User likes cats",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build();
			const memoryIdx = systemPrompt.indexOf("## Memory");
			const mgmtIdx = systemPrompt.indexOf("## Memory Management");
			expect(memoryIdx).toBeGreaterThanOrEqual(0);
			expect(mgmtIdx).toBeGreaterThan(memoryIdx);
		});

		it("contains instructions about selective logging", async () => {
			const builder = new ContextBuilder({
				...defaultOptions,
				memoryStore: {
					getMemoryContext: async () => "Some memory",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("remember this");
			expect(systemPrompt).toContain("edit_file");
			expect(systemPrompt).toContain("Do NOT log every message");
		});
	});

	describe("first conversation detection", () => {
		it("injects first-conversation section when USER.md has placeholder text", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(
				join(ws, "USER.md"),
				"# User Profile\n\n- Name: (your name here)\n- Timezone: (your timezone)",
			);
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["USER.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## First Conversation");
			expect(systemPrompt).toContain("introduce yourself");
			expect(systemPrompt).toContain("edit_file");
		});

		it("does NOT inject when USER.md has real user data", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(
				join(ws, "USER.md"),
				"# User Profile\n\n- Name: Alice\n- Timezone: America/New_York",
			);
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["USER.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## First Conversation");
		});

		it("does NOT inject when USER.md is missing", async () => {
			const ws = await makeTempWorkspace();
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["USER.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## First Conversation");
		});

		it("first-conversation section appears after bootstrap files and before memory", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "USER.md"), "# User Profile\n\n- Name: (your name here)");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["USER.md"],
				memoryStore: {
					getMemoryContext: async () => "Some memory",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build();
			const bootstrapIdx = systemPrompt.indexOf("## USER.md");
			const firstConvoIdx = systemPrompt.indexOf("## First Conversation");
			const memoryIdx = systemPrompt.indexOf("## Memory");
			expect(bootstrapIdx).toBeGreaterThanOrEqual(0);
			expect(firstConvoIdx).toBeGreaterThan(bootstrapIdx);
			expect(memoryIdx).toBeGreaterThan(firstConvoIdx);
		});

		it("contains key instruction phrases", async () => {
			const ws = await makeTempWorkspace();
			await writeFile(join(ws, "USER.md"), "# User Profile\n\n- Name: (your name here)");
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				bootstrapFiles: ["USER.md"],
			});
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("introduce yourself");
			expect(systemPrompt).toContain("edit_file");
			expect(systemPrompt).toContain("USER.md");
			expect(systemPrompt).toContain("MEMORY.md");
		});
	});

	describe("skills integration", () => {
		function makeSkillDir(name: string, frontmatter: string, body: string): string {
			const dir = mkdtempSync(join(tmpdir(), "skills-ctx-"));
			const skillDir = join(dir, name);
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}`);
			return dir;
		}

		it("omits skills section when no skillsLoader provided", async () => {
			const builder = new ContextBuilder(defaultOptions);
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).not.toContain("## Skills");
		});

		it("includes skills section when skillsLoader is provided", async () => {
			const dir = makeSkillDir("weather", 'name: weather\ndescription: "Check weather"', "# W");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const builder = new ContextBuilder({ ...defaultOptions, skillsLoader: loader });
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("## Skills");
			expect(systemPrompt).toContain("### Available Skills");
			expect(systemPrompt).toContain("read_file tool");
		});

		it("includes always-loaded skills with full content", async () => {
			const dir = makeSkillDir(
				"core-skill",
				'name: core-skill\ndescription: "Core"\nalways: true',
				"Always loaded content here.",
			);
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const builder = new ContextBuilder({ ...defaultOptions, skillsLoader: loader });
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("### Active Skills");
			expect(systemPrompt).toContain("#### core-skill");
			expect(systemPrompt).toContain("Always loaded content here.");
		});

		it("includes XML summary for non-always skills", async () => {
			const dir = makeSkillDir("weather", 'name: weather\ndescription: "Check weather"', "# W");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const builder = new ContextBuilder({ ...defaultOptions, skillsLoader: loader });
			const { systemPrompt } = await builder.build();
			expect(systemPrompt).toContain("<skills>");
			expect(systemPrompt).toContain('name="weather"');
			expect(systemPrompt).toContain("</skills>");
		});

		it("skills section appears between memory and session", async () => {
			const ws = await makeTempWorkspace();
			const skillDir = makeSkillDir("test", 'name: test\ndescription: "T"', "# T");
			const loader = new SkillsLoader({ builtinSkillsDir: skillDir });
			const builder = new ContextBuilder({
				...defaultOptions,
				workspacePath: ws,
				skillsLoader: loader,
				memoryStore: {
					getMemoryContext: async () => "Some memory",
					getRecentMemories: async () => "",
					getMemoryFilePath: () => "",
					getDailyNotePath: () => "",
				},
			});
			const { systemPrompt } = await builder.build({
				channelName: "terminal",
			});
			const memoryIdx = systemPrompt.indexOf("## Memory");
			const skillsIdx = systemPrompt.indexOf("## Skills");
			const sessionIdx = systemPrompt.indexOf("## Session");
			expect(memoryIdx).toBeGreaterThanOrEqual(0);
			expect(skillsIdx).toBeGreaterThan(memoryIdx);
			expect(sessionIdx).toBeGreaterThan(skillsIdx);
		});
	});
});
