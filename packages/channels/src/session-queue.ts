import type { InboundMessage } from "@featherbot/bus";
import type { AgentLoopResult } from "@featherbot/core";
import type { AgentProcessor } from "./adapter.js";

export const BATCHED_FINISH_REASON = "batched";

export interface SessionQueueOptions {
	debounceMs?: number;
}

interface PendingMessage {
	message: InboundMessage;
	resolve: (result: AgentLoopResult) => void;
	reject: (error: unknown) => void;
}

interface SessionState {
	pending: PendingMessage[];
	timer: ReturnType<typeof setTimeout> | null;
	processing: boolean;
}

const BATCHED_SENTINEL: AgentLoopResult = {
	text: "",
	usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
	steps: 0,
	finishReason: BATCHED_FINISH_REASON,
	toolCalls: [],
	toolResults: [],
};

export class SessionQueue implements AgentProcessor {
	private readonly agent: AgentProcessor;
	private readonly debounceMs: number;
	private readonly sessions = new Map<string, SessionState>();
	private disposed = false;

	constructor(agent: AgentProcessor, options: SessionQueueOptions = {}) {
		this.agent = agent;
		this.debounceMs = options.debounceMs ?? 2000;
	}

	async processMessage(inbound: InboundMessage): Promise<AgentLoopResult> {
		if (this.disposed) {
			throw new Error("SessionQueue is disposed");
		}

		const key = `${inbound.channel}:${inbound.chatId}`;

		return new Promise<AgentLoopResult>((resolve, reject) => {
			let state = this.sessions.get(key);
			if (!state) {
				state = { pending: [], timer: null, processing: false };
				this.sessions.set(key, state);
			}

			state.pending.push({ message: inbound, resolve, reject });

			if (state.processing) {
				// Agent is busy for this session — messages queue without a timer.
				// They'll be flushed after the current processing completes.
				return;
			}

			// Reset debounce timer
			if (state.timer !== null) {
				clearTimeout(state.timer);
			}
			state.timer = setTimeout(() => this.flush(key), this.debounceMs);
		});
	}

	private async flush(key: string): Promise<void> {
		const state = this.sessions.get(key);
		if (!state || state.pending.length === 0) {
			return;
		}

		state.timer = null;
		state.processing = true;

		const batch = state.pending.splice(0);
		const merged = this.mergeBatch(batch);

		try {
			const result = await this.agent.processMessage(merged);

			// Last caller gets the real result; earlier callers get batched sentinel
			for (let i = 0; i < batch.length - 1; i++) {
				const entry = batch[i];
				if (entry) entry.resolve(BATCHED_SENTINEL);
			}
			const last = batch[batch.length - 1];
			if (last) last.resolve(result);
		} catch (err) {
			for (const entry of batch) {
				entry.reject(err);
			}
		} finally {
			state.processing = false;

			if (state.pending.length > 0) {
				// New messages arrived during processing — start a new debounce cycle
				state.timer = setTimeout(() => this.flush(key), this.debounceMs);
			} else {
				// No pending messages — clean up session state
				this.sessions.delete(key);
			}
		}
	}

	private mergeBatch(batch: PendingMessage[]): InboundMessage {
		const first = batch[0];
		if (batch.length === 1 && first) {
			return first.message;
		}

		const lastEntry = batch[batch.length - 1];
		// batch is guaranteed non-empty (checked before calling mergeBatch)
		const last = (lastEntry ?? first)?.message as InboundMessage;
		const content = batch.map((b) => b.message.content).join("\n");

		const mediaSet = new Set<string>();
		for (const b of batch) {
			for (const m of b.message.media) {
				mediaSet.add(m);
			}
		}

		const metadata: Record<string, unknown> = {};
		for (const b of batch) {
			Object.assign(metadata, b.message.metadata);
		}

		return {
			channel: last.channel,
			senderId: last.senderId,
			chatId: last.chatId,
			content,
			timestamp: last.timestamp,
			media: [...mediaSet],
			metadata,
			messageId: last.messageId,
		};
	}

	dispose(): void {
		this.disposed = true;
		for (const [key, state] of this.sessions) {
			if (state.timer !== null) {
				clearTimeout(state.timer);
				state.timer = null;
			}
			for (const entry of state.pending) {
				entry.reject(new Error("SessionQueue disposed"));
			}
			state.pending.length = 0;
			this.sessions.delete(key);
		}
	}
}
