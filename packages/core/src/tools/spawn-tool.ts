import { z } from "zod";
import type { SubagentManager } from "../agent/subagent.js";
import type { LLMMessage } from "../provider/types.js";
import type { Tool } from "./types.js";

export interface SpawnToolOriginContext {
	channel: string;
	chatId: string;
}

const MAX_CONTEXT_PAIRS = 5;
const MAX_CONTEXT_CHARS = 2000;

export function captureParentContext(messages: LLMMessage[]): string {
	const pairs: string[] = [];
	const conversational = messages.filter((m) => m.role === "user" || m.role === "assistant");
	const recent = conversational.slice(-MAX_CONTEXT_PAIRS * 2);

	for (const msg of recent) {
		const label = msg.role === "user" ? "User" : "Assistant";
		const truncated =
			msg.content.length > MAX_CONTEXT_CHARS
				? `${msg.content.slice(0, MAX_CONTEXT_CHARS)}...`
				: msg.content;
		pairs.push(`${label}: ${truncated}`);
	}

	return pairs.join("\n");
}

export class SpawnTool implements Tool {
	readonly name = "spawn";
	readonly description =
		"Spawn a background sub-agent to handle a task asynchronously. You can specify a specialization type (researcher, coder, analyst). Results are delivered back to the originating channel when complete.";
	readonly parameters = z.object({
		task: z.string().describe("The task description for the sub-agent to execute"),
		type: z
			.enum(["general", "researcher", "coder", "analyst"])
			.optional()
			.describe("Sub-agent specialization (default: general)"),
	});

	private readonly manager: SubagentManager;
	private readonly originContext: SpawnToolOriginContext;
	private readonly getParentHistory?: () => LLMMessage[];
	private readonly getMemoryContext?: () => Promise<string>;

	constructor(
		manager: SubagentManager,
		originContext: SpawnToolOriginContext,
		options?: {
			getParentHistory?: () => LLMMessage[];
			getMemoryContext?: () => Promise<string>;
		},
	) {
		this.manager = manager;
		this.originContext = originContext;
		this.getParentHistory = options?.getParentHistory;
		this.getMemoryContext = options?.getMemoryContext;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const p = params as z.infer<typeof this.parameters>;
		try {
			let parentContext: string | undefined;
			if (this.getParentHistory) {
				const history = this.getParentHistory();
				if (history.length > 0) {
					parentContext = captureParentContext(history);
				}
			}

			let memoryContext: string | undefined;
			if (this.getMemoryContext) {
				try {
					memoryContext = await this.getMemoryContext();
				} catch {
					// Memory unavailable — proceed without it
				}
			}

			const id = this.manager.spawn({
				task: p.task,
				originChannel: this.originContext.channel,
				originChatId: this.originContext.chatId,
				type: p.type,
				parentContext,
				memoryContext,
			});
			const typeLabel = p.type ?? "general";
			return `Sub-agent spawned successfully (type: ${typeLabel}). Task ID: ${id}\nTask: ${p.task}\nResults will be delivered when complete.`;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error spawning sub-agent: ${message}`;
		}
	}
}

export class SubagentStatusTool implements Tool {
	readonly name = "subagent_status";
	readonly description =
		"Check the status of background sub-agents, or cancel a running one. Provide an ID to check a specific sub-agent, omit to list all active, or use action 'cancel' with an ID to cancel.";
	readonly parameters = z.object({
		id: z.string().optional().describe("Specific sub-agent task ID to check or cancel"),
		action: z.enum(["status", "cancel"]).optional().describe("Action to perform (default: status)"),
	});

	private readonly manager: SubagentManager;

	constructor(manager: SubagentManager) {
		this.manager = manager;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const p = params as z.infer<typeof this.parameters>;
		const action = p.action ?? "status";

		if (action === "cancel") {
			if (p.id === undefined) {
				return "Error: an 'id' is required to cancel a sub-agent.";
			}
			const cancelled = this.manager.cancel(p.id);
			return cancelled
				? `Sub-agent ${p.id} has been cancelled.`
				: `Could not cancel sub-agent ${p.id} (not found or not running).`;
		}

		if (p.id !== undefined) {
			const state = this.manager.getState(p.id);
			if (state === undefined) {
				return `No sub-agent found with ID: ${p.id}`;
			}
			let result = `Sub-agent ${state.id} (${state.spec.name}):\n  Task: ${state.task}\n  Status: ${state.status}\n  Started: ${state.startedAt.toISOString()}`;
			if (state.completedAt !== undefined) {
				result += `\n  Completed: ${state.completedAt.toISOString()}`;
			}
			if (state.result !== undefined) {
				result += `\n  Result: ${state.result}`;
			}
			if (state.error !== undefined) {
				result += `\n  Error: ${state.error}`;
			}
			return result;
		}

		const active = this.manager.listActive();
		if (active.length === 0) {
			return "No active sub-agents.";
		}

		const lines: string[] = [];
		for (const state of active) {
			lines.push(
				`- ${state.id} [${state.spec.name}]: ${state.task} (${state.status}, started ${state.startedAt.toISOString()})`,
			);
		}
		return `Active sub-agents:\n${lines.join("\n")}`;
	}
}
