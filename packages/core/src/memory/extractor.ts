interface AgentLoopLike {
	processDirect(
		message: string,
		options?: { systemPrompt?: string; sessionKey?: string },
	): Promise<{ text: string }>;
}

export interface MemoryExtractorOptions {
	agentLoop: AgentLoopLike;
	idleMs?: number;
	enabled?: boolean;
}

const EXTRACTION_PROMPT = `Review the conversation above. Extract any user facts, preferences, dates, habits, or patterns worth remembering and persist them to memory/MEMORY.md via edit_file.

Only persist NEW information not already present in memory. If there is nothing new to persist, respond with SKIP.`;

export class MemoryExtractor {
	private readonly agentLoop: AgentLoopLike;
	private readonly idleMs: number;
	private readonly enabled: boolean;
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly running = new Set<string>();

	constructor(options: MemoryExtractorOptions) {
		this.agentLoop = options.agentLoop;
		this.idleMs = options.idleMs ?? 300_000;
		this.enabled = options.enabled ?? true;
	}

	scheduleExtraction(sessionKey: string): void {
		if (!this.enabled) return;

		const existing = this.timers.get(sessionKey);
		if (existing !== undefined) {
			clearTimeout(existing);
		}

		const timer = setTimeout(() => {
			this.timers.delete(sessionKey);
			void this.extract(sessionKey);
		}, this.idleMs);

		this.timers.set(sessionKey, timer);
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
	}

	private async extract(sessionKey: string): Promise<void> {
		if (this.running.has(sessionKey)) return;
		this.running.add(sessionKey);
		try {
			await this.agentLoop.processDirect(EXTRACTION_PROMPT, { sessionKey });
		} catch {
			/* best-effort */
		} finally {
			this.running.delete(sessionKey);
		}
	}
}
