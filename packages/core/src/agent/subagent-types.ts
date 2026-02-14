import type { SubagentSpec } from "./subagent-specs.js";

export type SubagentStatus = "running" | "completed" | "failed" | "cancelled";

export interface SubagentState {
	id: string;
	task: string;
	status: SubagentStatus;
	result?: string;
	error?: string;
	startedAt: Date;
	completedAt?: Date;
	originChannel: string;
	originChatId: string;
	spec: SubagentSpec;
	abortController: AbortController;
}

export interface SpawnOptions {
	task: string;
	originChannel: string;
	originChatId: string;
	type?: string;
	model?: string;
	parentContext?: string;
	memoryContext?: string;
}
