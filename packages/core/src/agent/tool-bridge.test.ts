import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool } from "../tools/types.js";
import { buildToolMap } from "./tool-bridge.js";

function createMockTool(name: string, description = "mock tool"): Tool {
	return {
		name,
		description,
		parameters: z.object({ input: z.string() }),
		execute: async (params) => `result: ${(params as { input: string }).input}`,
	};
}

describe("buildToolMap", () => {
	it("returns empty object for empty registry", () => {
		const registry = new ToolRegistry();
		const map = buildToolMap(registry);
		expect(map).toEqual({});
	});

	it("maps a single tool", () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("echo", "echoes input"));
		const map = buildToolMap(registry);

		expect(Object.keys(map)).toEqual(["echo"]);
		expect(map.echo?.name).toBe("echo");
		expect(map.echo?.description).toBe("echoes input");
		expect(map.echo?.parameters).toBeDefined();
	});

	it("maps multiple tools", () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("tool_a"));
		registry.register(createMockTool("tool_b"));
		registry.register(createMockTool("tool_c"));
		const map = buildToolMap(registry);

		expect(Object.keys(map).sort()).toEqual(["tool_a", "tool_b", "tool_c"]);
	});

	it("wires execute to registry.execute", async () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("echo"));
		const map = buildToolMap(registry);

		const result = await map.echo?.execute({ input: "hello" });
		expect(result).toBe("result: hello");
	});

	it("execute returns error for invalid params via registry", async () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("echo"));
		const map = buildToolMap(registry);

		const result = await map.echo?.execute({ wrong: 123 });
		expect(result).toContain("Error");
	});
});
