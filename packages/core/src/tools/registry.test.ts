import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";

function createMockTool(overrides: Partial<Tool> = {}): Tool {
	return {
		name: "test_tool",
		description: "A test tool",
		parameters: z.object({ input: z.string() }),
		execute: async (params) => `result: ${(params as { input: string }).input}`,
		...overrides,
	};
}

describe("ToolRegistry", () => {
	describe("register", () => {
		it("registers a tool by name", () => {
			const registry = new ToolRegistry();
			const tool = createMockTool();
			registry.register(tool);
			expect(registry.has("test_tool")).toBe(true);
		});

		it("throws on duplicate registration", () => {
			const registry = new ToolRegistry();
			const tool = createMockTool();
			registry.register(tool);
			expect(() => registry.register(tool)).toThrow("Tool 'test_tool' is already registered");
		});
	});

	describe("unregister", () => {
		it("removes a registered tool", () => {
			const registry = new ToolRegistry();
			registry.register(createMockTool());
			expect(registry.unregister("test_tool")).toBe(true);
			expect(registry.has("test_tool")).toBe(false);
		});

		it("returns false for unknown tool", () => {
			const registry = new ToolRegistry();
			expect(registry.unregister("nonexistent")).toBe(false);
		});
	});

	describe("get", () => {
		it("returns the tool by name", () => {
			const registry = new ToolRegistry();
			const tool = createMockTool();
			registry.register(tool);
			expect(registry.get("test_tool")).toBe(tool);
		});

		it("returns undefined for unknown tool", () => {
			const registry = new ToolRegistry();
			expect(registry.get("nonexistent")).toBeUndefined();
		});
	});

	describe("has", () => {
		it("returns true for registered tool", () => {
			const registry = new ToolRegistry();
			registry.register(createMockTool());
			expect(registry.has("test_tool")).toBe(true);
		});

		it("returns false for unknown tool", () => {
			const registry = new ToolRegistry();
			expect(registry.has("nonexistent")).toBe(false);
		});
	});

	describe("execute", () => {
		it("executes a tool and returns the result", async () => {
			const registry = new ToolRegistry();
			registry.register(createMockTool());
			const result = await registry.execute("test_tool", {
				input: "hello",
			});
			expect(result).toBe("result: hello");
		});

		it("returns error string for unknown tool", async () => {
			const registry = new ToolRegistry();
			const result = await registry.execute("nonexistent", {});
			expect(result).toBe("Error: Tool 'nonexistent' not found");
		});

		it("returns error string for invalid parameters", async () => {
			const registry = new ToolRegistry();
			registry.register(createMockTool());
			const result = await registry.execute("test_tool", {
				input: 123,
			});
			expect(result).toContain("Error: Invalid parameters for 'test_tool'");
		});

		it("returns error string when tool execution throws", async () => {
			const registry = new ToolRegistry();
			registry.register(
				createMockTool({
					execute: async () => {
						throw new Error("something broke");
					},
				}),
			);
			const result = await registry.execute("test_tool", {
				input: "hello",
			});
			expect(result).toBe("Error executing 'test_tool': something broke");
		});

		it("handles non-Error throws gracefully", async () => {
			const registry = new ToolRegistry();
			registry.register(
				createMockTool({
					execute: async () => {
						throw "string error";
					},
				}),
			);
			const result = await registry.execute("test_tool", {
				input: "hello",
			});
			expect(result).toBe("Error executing 'test_tool': string error");
		});

		it("passes parsed (validated) params to execute", async () => {
			const registry = new ToolRegistry();
			const tool = createMockTool({
				parameters: z.object({
					count: z.number().default(5),
				}),
				execute: async (params) => `count: ${(params as { count: number }).count}`,
			});
			registry.register(tool);
			const result = await registry.execute("test_tool", {});
			expect(result).toBe("count: 5");
		});
	});

	describe("getRegisteredNames", () => {
		it("returns a set of all registered tool names", () => {
			const registry = new ToolRegistry();
			registry.register(createMockTool({ name: "tool_a" }));
			registry.register(createMockTool({ name: "tool_b" }));

			const names = registry.getRegisteredNames();
			expect(names).toBeInstanceOf(Set);
			expect(names.size).toBe(2);
			expect(names.has("tool_a")).toBe(true);
			expect(names.has("tool_b")).toBe(true);
		});

		it("returns empty set when no tools registered", () => {
			const registry = new ToolRegistry();
			const names = registry.getRegisteredNames();
			expect(names.size).toBe(0);
		});

		it("returns a new set (not a reference to internal state)", () => {
			const registry = new ToolRegistry();
			registry.register(createMockTool({ name: "tool_a" }));
			const names = registry.getRegisteredNames();
			names.add("fake_tool");
			expect(registry.has("fake_tool")).toBe(false);
		});
	});

	describe("getDefinitions", () => {
		it("returns definitions for all registered tools", () => {
			const registry = new ToolRegistry();
			registry.register(createMockTool({ name: "tool_a" }));
			registry.register(createMockTool({ name: "tool_b" }));

			const defs = registry.getDefinitions();
			expect(defs).toHaveLength(2);
			expect(defs.map((d) => d.name)).toEqual(["tool_a", "tool_b"]);
		});

		it("returns empty array when no tools registered", () => {
			const registry = new ToolRegistry();
			expect(registry.getDefinitions()).toEqual([]);
		});

		it("includes name, description, and parameters", () => {
			const registry = new ToolRegistry();
			const params = z.object({ input: z.string() });
			registry.register(
				createMockTool({
					name: "my_tool",
					description: "My tool description",
					parameters: params,
				}),
			);

			const defs = registry.getDefinitions();
			expect(defs).toHaveLength(1);
			expect(defs[0]?.name).toBe("my_tool");
			expect(defs[0]?.description).toBe("My tool description");
			expect(defs[0]?.parameters).toBe(params);
		});
	});
});
