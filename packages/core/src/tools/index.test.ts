import { describe, expect, it } from "vitest";
import { FeatherBotConfigSchema } from "../config/schema.js";
import type { MemoryStore } from "../memory/types.js";
import { createToolRegistry } from "./index.js";

function makeConfig(overrides?: Record<string, unknown>) {
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
	it("returns a registry with core tools (no API keys = no search tools)", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("exec")).toBe(true);
		expect(registry.has("read_file")).toBe(true);
		expect(registry.has("write_file")).toBe(true);
		expect(registry.has("edit_file")).toBe(true);
		expect(registry.has("list_dir")).toBe(true);
		expect(registry.has("web_fetch")).toBe(true);
		expect(registry.has("web_search")).toBe(false);
		expect(registry.has("firecrawl_search")).toBe(false);
		expect(registry.has("firecrawl_crawl")).toBe(false);
	});

	it("has 7 tool definitions without API keys or memoryStore", () => {
		const registry = createToolRegistry(makeConfig());
		const defs = registry.getDefinitions();
		expect(defs).toHaveLength(7);
	});

	it("registers web_search when Brave API key is configured", () => {
		const config = makeConfig({ tools: { web: { search: { apiKey: "test-brave-key" } } } });
		const registry = createToolRegistry(config);
		expect(registry.has("web_search")).toBe(true);
		expect(registry.getDefinitions()).toHaveLength(8);
	});

	it("registers firecrawl tools when Firecrawl API key is configured", () => {
		const config = makeConfig({ tools: { web: { firecrawl: { apiKey: "fc-test-key" } } } });
		const registry = createToolRegistry(config);
		expect(registry.has("firecrawl_search")).toBe(true);
		expect(registry.has("firecrawl_crawl")).toBe(true);
		expect(registry.getDefinitions()).toHaveLength(9);
	});

	it("registers all tools when all API keys are configured", () => {
		const config = makeConfig({
			tools: {
				web: {
					search: { apiKey: "brave-key" },
					firecrawl: { apiKey: "fc-key" },
				},
			},
		});
		const registry = createToolRegistry(config);
		expect(registry.getDefinitions()).toHaveLength(10);
	});

	it("registers recall_recent when memoryStore is provided", () => {
		const config = makeConfig({
			tools: {
				web: {
					search: { apiKey: "brave-key" },
					firecrawl: { apiKey: "fc-key" },
				},
			},
		});
		const registry = createToolRegistry(config, {
			memoryStore: makeMockMemoryStore(),
		});
		expect(registry.has("recall_recent")).toBe(true);
		expect(registry.getDefinitions()).toHaveLength(11);
	});

	it("does not register recall_recent without memoryStore", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("recall_recent")).toBe(false);
	});

	it("exec tool is callable via registry", async () => {
		const registry = createToolRegistry(makeConfig());
		const result = await registry.execute("exec", { command: "echo hello", workingDir: "/tmp" });
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
