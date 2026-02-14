export type ToolPreset = "web" | "files" | "full" | "read-only";

export interface SubagentSpec {
	name: string;
	systemPrompt: string;
	toolPreset: ToolPreset;
	model?: string;
	maxIterations?: number;
}

/**
 * Maps each preset to the set of tool names it allows.
 * Tools not listed here (spawn, subagent_status, cron) are always blocked.
 */
export const TOOL_PRESET_MAP: Record<ToolPreset, Set<string>> = {
	full: new Set([
		"exec",
		"read_file",
		"write_file",
		"edit_file",
		"list_dir",
		"web_search",
		"web_fetch",
		"firecrawl_search",
		"firecrawl_crawl",
		"recall_recent",
		"todo",
	]),
	files: new Set(["exec", "read_file", "write_file", "edit_file", "list_dir"]),
	web: new Set(["web_search", "web_fetch", "firecrawl_search", "firecrawl_crawl"]),
	"read-only": new Set([
		"read_file",
		"list_dir",
		"web_search",
		"web_fetch",
		"firecrawl_search",
		"firecrawl_crawl",
		"recall_recent",
	]),
};

/** Tool names that are always blocked for sub-agents (prevent recursion). */
export const BLOCKED_TOOLS = new Set(["spawn", "subagent_status", "cron"]);

export type BuiltinSpecName = "general" | "researcher" | "coder" | "analyst";

export const BUILTIN_SPECS: { [K in BuiltinSpecName]: SubagentSpec } = {
	general: {
		name: "general",
		systemPrompt:
			"You are a FeatherBot sub-agent. Complete the given task using the available tools. Be concise and focused. Report your result clearly when done.",
		toolPreset: "full",
	},
	researcher: {
		name: "researcher",
		systemPrompt:
			"You are a FeatherBot research sub-agent. Your job is to gather information, search the web, read files, and compile findings. Do NOT modify any files. Be thorough and cite sources when possible. Report your findings clearly.",
		toolPreset: "read-only",
	},
	coder: {
		name: "coder",
		systemPrompt:
			"You are a FeatherBot coding sub-agent. Your job is to write, edit, and execute code. Focus on clean, working implementations. Test your changes when possible. Report what you changed and the outcome.",
		toolPreset: "files",
	},
	analyst: {
		name: "analyst",
		systemPrompt:
			"You are a FeatherBot analysis sub-agent. Your job is to analyze data, files, and information using all available tools. Provide structured, data-driven insights. Be precise with numbers and include key takeaways.",
		toolPreset: "full",
	},
};

function isBuiltinSpecName(name: string): name is BuiltinSpecName {
	return name in BUILTIN_SPECS;
}

export function resolveSpec(name?: string): SubagentSpec {
	if (name === undefined) return BUILTIN_SPECS.general;
	if (isBuiltinSpecName(name)) return BUILTIN_SPECS[name];
	return BUILTIN_SPECS.general;
}
