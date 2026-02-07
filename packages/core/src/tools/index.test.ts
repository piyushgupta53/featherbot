import { describe, expect, it } from "vitest";
import type { FeatherBotConfig } from "../config/schema.js";
import { FeatherBotConfigSchema } from "../config/schema.js";
import { createToolRegistry } from "./index.js";

function makeConfig(overrides?: Partial<FeatherBotConfig>): FeatherBotConfig {
	return FeatherBotConfigSchema.parse(overrides ?? {});
}

describe("createToolRegistry", () => {
	it("returns a registry with all 5 built-in tools", () => {
		const registry = createToolRegistry(makeConfig());
		expect(registry.has("exec")).toBe(true);
		expect(registry.has("read_file")).toBe(true);
		expect(registry.has("write_file")).toBe(true);
		expect(registry.has("edit_file")).toBe(true);
		expect(registry.has("list_dir")).toBe(true);
	});

	it("has exactly 5 tool definitions", () => {
		const registry = createToolRegistry(makeConfig());
		const defs = registry.getDefinitions();
		expect(defs).toHaveLength(5);
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
