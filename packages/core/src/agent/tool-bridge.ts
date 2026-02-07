import type { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../types.js";

export function buildToolMap(registry: ToolRegistry): Record<string, ToolDefinition> {
	const definitions = registry.getDefinitions();
	const toolMap: Record<string, ToolDefinition> = {};

	for (const def of definitions) {
		toolMap[def.name] = {
			name: def.name,
			description: def.description,
			parameters: def.parameters,
			execute: (params: Record<string, unknown>) => registry.execute(def.name, params),
		};
	}

	return toolMap;
}
