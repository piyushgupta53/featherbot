import type { z } from "zod";
import type { EvictLargeResultOptions } from "./result-evictor.js";
import { evictLargeResult } from "./result-evictor.js";
import type { Tool } from "./types.js";

export interface ToolRegistryDefinition {
	name: string;
	description: string;
	// biome-ignore lint/suspicious/noExplicitAny: ZodObject requires type params that vary per tool
	parameters: z.ZodObject<any>;
}

export class ToolRegistry {
	private tools = new Map<string, Tool>();
	private evictionOptions?: EvictLargeResultOptions;

	setEvictionOptions(options: EvictLargeResultOptions): void {
		this.evictionOptions = options;
	}

	getEvictionOptions(): EvictLargeResultOptions | undefined {
		return this.evictionOptions;
	}

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
				const issues = parsed.error.issues
					.map((i) => {
						const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
						return `${path}${i.message}`;
					})
					.join(", ");
				const shape = Object.entries(tool.parameters.shape)
					.map(([key, val]) => {
						// biome-ignore lint/suspicious/noExplicitAny: Zod shape values have complex types
						const v = val as any;
						const opt = v.isOptional?.() ? "?" : "";
						const desc = v._def?.description ?? v.unwrap?.()._def?.description ?? "";
						return `  ${key}${opt}: ${desc}`;
					})
					.join("\n");
				return `Error: Invalid parameters for '${name}': ${issues}\nExpected schema:\n${shape}`;
			}

			const output = await tool.execute(parsed.data);
			return this.evictionOptions ? evictLargeResult(output, this.evictionOptions) : output;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error executing '${name}': ${message}`;
		}
	}

	getRegisteredNames(): Set<string> {
		return new Set(this.tools.keys());
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
