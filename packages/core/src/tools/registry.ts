import type { z } from "zod";
import type { Tool } from "./types.js";

export interface ToolRegistryDefinition {
	name: string;
	description: string;
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject requires type params that vary per tool
	parameters: z.ZodObject<any>;
}

export class ToolRegistry {
	private tools = new Map<string, Tool>();

	register(tool: Tool): void {
		if (this.tools.has(tool.name)) {
			throw new Error(`Tool '${tool.name}' is already registered`);
		}
		this.tools.set(tool.name, tool);
	}

	unregister(name: string): boolean {
		return this.tools.delete(name);
	}

	get(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	async execute(name: string, params: Record<string, unknown>): Promise<string> {
		const tool = this.tools.get(name);
		if (tool === undefined) {
			return `Error: Tool '${name}' not found`;
		}

		try {
			const parsed = tool.parameters.safeParse(params);
			if (!parsed.success) {
				const issues = parsed.error.issues.map((i) => i.message).join(", ");
				return `Error: Invalid parameters for '${name}': ${issues}`;
			}

			return await tool.execute(parsed.data);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error executing '${name}': ${message}`;
		}
	}

	getDefinitions(): ToolRegistryDefinition[] {
		const definitions: ToolRegistryDefinition[] = [];
		for (const tool of this.tools.values()) {
			definitions.push({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			});
		}
		return definitions;
	}
}
