import { randomUUID } from "node:crypto";
import type { FeatherBotConfig } from "../config/schema.js";
import type { MemoryStore } from "../memory/types.js";
import type { LLMProvider } from "../provider/types.js";
import { createToolRegistry } from "../tools/index.js";
import { ToolRegistry } from "../tools/registry.js";
import { AgentLoop } from "./loop.js";
import { BLOCKED_TOOLS, TOOL_PRESET_MAP, resolveSpec } from "./subagent-specs.js";
import type { SubagentSpec } from "./subagent-specs.js";
import type { SpawnOptions, SubagentState } from "./subagent-types.js";

function createToolRegistryForSpec(
	spec: SubagentSpec,
	config: FeatherBotConfig,
	memoryStore?: MemoryStore,
): ToolRegistry {
	const full = createToolRegistry(config, { memoryStore });
	const allowed = TOOL_PRESET_MAP[spec.toolPreset];
	const filtered = new ToolRegistry();

	const evictionOpts = full.getEvictionOptions();
	if (evictionOpts) {
		filtered.setEvictionOptions(evictionOpts);
	}

	for (const def of full.getDefinitions()) {
		if (BLOCKED_TOOLS.has(def.name)) continue;
		if (!allowed.has(def.name)) continue;
		const tool = full.get(def.name);
		if (tool) filtered.register(tool);
	}

	return filtered;
}

function buildSystemPrompt(
	spec: SubagentSpec,
	parentContext?: string,
	memoryContext?: string,
): string {
	const parts: string[] = [spec.systemPrompt];

	if (parentContext) {
		parts.push("", "## Parent Context", parentContext);
	}
	if (memoryContext) {
		parts.push("", "## User Memory (read-only reference)", memoryContext);
	}

	return parts.join("\n");
}

/** Max finished agent entries to keep in memory for status lookups. */
const MAX_FINISHED_RETENTION = 50;

export class SubagentManager {
	private readonly provider: LLMProvider;
	private readonly config: FeatherBotConfig;
	private readonly onComplete: (state: SubagentState) => void | Promise<void>;
	private readonly agents = new Map<string, SubagentState>();
	private readonly memoryStore?: MemoryStore;

	constructor(
		provider: LLMProvider,
		config: FeatherBotConfig,
		onComplete: (state: SubagentState) => void | Promise<void>,
		memoryStore?: MemoryStore,
	) {
		this.provider = provider;
		this.config = config;
		this.onComplete = onComplete;
		this.memoryStore = memoryStore;
	}

	/** Remove oldest finished agents when retention limit is exceeded. */
	private pruneFinished(): void {
		const finished = [...this.agents.entries()]
			.filter(([, s]) => s.status !== "running")
			.sort((a, b) => {
				const ta = a[1].completedAt?.getTime() ?? 0;
				const tb = b[1].completedAt?.getTime() ?? 0;
				return ta - tb;
			});
		const excess = finished.length - MAX_FINISHED_RETENTION;
		for (let i = 0; i < excess; i++) {
			const entry = finished[i];
			if (entry !== undefined) {
				this.agents.delete(entry[0]);
			}
		}
	}

	spawn(options: SpawnOptions): string {
		this.pruneFinished();
		const id = randomUUID();
		const spec = resolveSpec(options.type);
		const abortController = new AbortController();

		const state: SubagentState = {
			id,
			task: options.task,
			status: "running",
			startedAt: new Date(),
			originChannel: options.originChannel,
			originChatId: options.originChatId,
			spec,
			abortController,
		};
		this.agents.set(id, state);

		const toolRegistry = createToolRegistryForSpec(spec, this.config, this.memoryStore);
		const effectiveModel = options.model ?? spec.model;
		const agentConfig = {
			...this.config.agents.defaults,
			maxToolIterations: spec.maxIterations ?? this.config.subagent.maxIterations,
			...(effectiveModel ? { model: effectiveModel } : {}),
		};

		const agentLoop = new AgentLoop({
			provider: this.provider,
			toolRegistry,
			config: agentConfig,
		});

		const systemPrompt = buildSystemPrompt(spec, options.parentContext, options.memoryContext);

		const taskPromise = agentLoop.processDirect(options.task, {
			systemPrompt,
			sessionKey: `subagent:${id}`,
			signal: abortController.signal,
		});

		const timeoutMs = this.config.subagent.timeoutMs;
		let cleanupTimer: (() => void) | undefined;

		const timeoutPromise = new Promise<never>((_, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("Sub-agent timed out"));
			}, timeoutMs);
			cleanupTimer = () => clearTimeout(timer);
			// Clear timeout if user cancels first
			abortController.signal.addEventListener("abort", () => clearTimeout(timer), {
				once: true,
			});
		});

		const cancelPromise = new Promise<never>((_, reject) => {
			if (abortController.signal.aborted) {
				reject(new Error("Cancelled by user"));
				return;
			}
			abortController.signal.addEventListener(
				"abort",
				() => {
					reject(new Error("Cancelled by user"));
				},
				{ once: true },
			);
		});

		Promise.race([taskPromise, timeoutPromise, cancelPromise])
			.then((result) => {
				cleanupTimer?.();
				state.status = "completed";
				state.result = result.text;
				state.completedAt = new Date();
				return this.onComplete(state);
			})
			.catch((err) => {
				cleanupTimer?.();
				if (abortController.signal.aborted) {
					state.status = "cancelled";
					state.error = "Cancelled by user";
				} else {
					state.status = "failed";
					state.error = err instanceof Error ? err.message : String(err);
				}
				state.completedAt = new Date();
				return this.onComplete(state);
			});

		return id;
	}

	cancel(id: string): boolean {
		const state = this.agents.get(id);
		if (state === undefined || state.status !== "running") return false;
		state.abortController.abort();
		return true;
	}

	getState(id: string): SubagentState | undefined {
		return this.agents.get(id);
	}

	listActive(): SubagentState[] {
		return [...this.agents.values()].filter((s) => s.status === "running");
	}

	listAll(): SubagentState[] {
		return [...this.agents.values()];
	}
}
