import { describe, expect, it } from "vitest";
import type { FeatherBotConfig } from "../config/schema.js";
import { FeatherBotConfigSchema } from "../config/schema.js";
import { createToolRegistry } from "./index.js";

function makeConfig(overrides?: Partial<FeatherBotConfig>): FeatherBotConfig {
	return FeatherBotConfigSchema.parse(overrides ?? {});
}

describe("web tools integration", () => {
	it("web_search is registered in createToolRegistry", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("web_search")).toBe(true);
	});

	it("web_fetch is registered in createToolRegistry", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("web_fetch")).toBe(true);
	});

	it("web_search has correct name and parameter schema", () => {
		const registry = createToolRegistry(makeConfig());
		const defs = registry.getDefinitions();
		const searchDef = defs.find((d) => d.name === "web_search");
		expect(searchDef).toBeDefined();
		expect(searchDef?.name).toBe("web_search");

		const shape = searchDef?.parameters.shape;
		expect(shape).toHaveProperty("query");
		expect(shape).toHaveProperty("count");
	});

	it("web_fetch has correct name and parameter schema", () => {
		const registry = createToolRegistry(makeConfig());
		const defs = registry.getDefinitions();
		const fetchDef = defs.find((d) => d.name === "web_fetch");
		expect(fetchDef).toBeDefined();
		expect(fetchDef?.name).toBe("web_fetch");

		const shape = fetchDef?.parameters.shape;
		expect(shape).toHaveProperty("url");
		expect(shape).toHaveProperty("mode");
	});

	it("web_search returns error when API key is missing", async () => {
		const registry = createToolRegistry(makeConfig());
		const result = await registry.execute("web_search", {
			query: "test query",
		});
		expect(result).toContain("Error");
		expect(result).toContain("API key");
	});

	it("web_fetch returns error for invalid URL", async () => {
		const registry = createToolRegistry(makeConfig());
		const result = await registry.execute("web_fetch", {
			url: "not-a-url",
		});
		expect(result).toContain("Error");
		expect(result).toContain("Invalid URL");
	});

	it("firecrawl_search is registered in createToolRegistry", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("firecrawl_search")).toBe(true);
	});

	it("firecrawl_crawl is registered in createToolRegistry", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("firecrawl_crawl")).toBe(true);
	});

	it("firecrawl_search has correct parameter schema", () => {
		const registry = createToolRegistry(makeConfig());
		const defs = registry.getDefinitions();
		const def = defs.find((d) => d.name === "firecrawl_search");
		expect(def).toBeDefined();
		const shape = def?.parameters.shape;
		expect(shape).toHaveProperty("query");
		expect(shape).toHaveProperty("limit");
	});

	it("firecrawl_crawl has correct parameter schema", () => {
		const registry = createToolRegistry(makeConfig());
		const defs = registry.getDefinitions();
		const def = defs.find((d) => d.name === "firecrawl_crawl");
		expect(def).toBeDefined();
		const shape = def?.parameters.shape;
		expect(shape).toHaveProperty("url");
		expect(shape).toHaveProperty("limit");
	});

	it("firecrawl_search returns error when API key is missing", async () => {
		const registry = createToolRegistry(makeConfig());
		const result = await registry.execute("firecrawl_search", {
			query: "test query",
		});
		expect(result).toContain("Error");
		expect(result).toContain("API key");
	});

	it("firecrawl_crawl returns error when API key is missing", async () => {
		const registry = createToolRegistry(makeConfig());
		const result = await registry.execute("firecrawl_crawl", {
			url: "https://example.com",
		});
		expect(result).toContain("Error");
		expect(result).toContain("API key");
	});
});
