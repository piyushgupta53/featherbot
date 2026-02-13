import { describe, expect, it } from "vitest";
import type { FeatherBotConfig } from "../config/schema.js";
import { FeatherBotConfigSchema } from "../config/schema.js";
import type { MemoryStore } from "../memory/types.js";
import { createToolRegistry } from "./index.js";

function makeConfig(overrides?: Partial<FeatherBotConfig>): FeatherBotConfig {
	return FeatherBotConfigSchema.parse(overrides ?? {});
}

function makeMockMemoryStore(): MemoryStore {
	return {
		getMemoryContext: async () => "",
		getRecentMemories: async () => "",
		getMemoryFilePath: () => "",
		getDailyNotePath: () => "",
		readMemoryFile: async () => "",
		writeMemoryFile: async () => {},
		readDailyNote: async () => "",
		writeDailyNote: async () => {},
		deleteDailyNote: async () => {},
		listDailyNotes: async () => [],
	};
}

describe("createToolRegistry", () => {
	it("returns a registry with all 9 built-in tools", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("exec")).toBe(true);
		expect(registry.has("read_file")).toBe(true);
		expect(registry.has("write_file")).toBe(true);
		expect(registry.has("edit_file")).toBe(true);
		expect(registry.has("list_dir")).toBe(true);
		expect(registry.has("web_search")).toBe(true);
		expect(registry.has("web_fetch")).toBe(true);
		expect(registry.has("firecrawl_search")).toBe(true);
		expect(registry.has("firecrawl_crawl")).toBe(true);
	});

	it("has exactly 9 tool definitions without memoryStore", () => {
		const registry = createToolRegistry(makeConfig());
		const defs = registry.getDefinitions();
		expect(defs).toHaveLength(9);
	});

	it("registers recall_recent when memoryStore is provided", () => {
		const registry = createToolRegistry(makeConfig(), {
			memoryStore: makeMockMemoryStore(),
		});
		expect(registry.has("recall_recent")).toBe(true);
		expect(registry.getDefinitions()).toHaveLength(10);
	});

	it("does not register recall_recent without memoryStore", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("recall_recent")).toBe(false);
	});

	it("exec tool is callable via registry", async () => {
		const registry = createToolRegistry(makeConfig());
		const result = await registry.execute("exec", { command: "echo hello" });
		expect(result).toBe("hello");
	});

	it("read_file returns error for missing file", async () => {
		const registry = createToolRegistry(makeConfig());
		const result = await registry.execute("read_file", { path: "/nonexistent-file-abc123.txt" });
		expect(result).toContain("File not found");
	});

	it("list_dir returns error for missing directory", async () => {
		const registry = createToolRegistry(makeConfig());
		const result = await registry.execute("list_dir", { path: "/nonexistent-dir-abc123" });
		expect(result).toContain("not found");
	});
});
