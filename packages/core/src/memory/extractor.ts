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

const EXTRACTION_PROMPT = `Review the conversation above and produce a compressed observation log.

## Step 1 — Daily Note Observations

Append observations to today's daily note (memory/YYYY-MM-DD.md) using edit_file.
Use a session header (e.g., "## telegram:123") based on the current session, then list priority-tagged observations:

- 🔴 Important — decisions made, action items, explicit requests to remember, strong preferences
- 🟡 Moderate — topics discussed, tasks worked on, notable context, preferences expressed
- 🟢 Minor — informational details, small talk, passing mentions

Nest related sub-observations under a parent. Keep each observation to one concise line.

Example format:
\`\`\`
## telegram:123
- 🔴 User decided to migrate API from REST to GraphQL
  - 🟡 Discussed trade-offs: type safety vs complexity
  - 🟢 Mentioned Apollo Client as preferred library
- 🟡 Worked on debugging auth token expiry issue
- 🔴 ACTION: deploy staging build before Friday
\`\`\`

## Step 2 — Long-term Memory

After writing observations, update memory/MEMORY.md with any NEW facts, preferences, or pending items not already present — same as before.

## Rules

- If there is nothing worth recording from this conversation, respond with SKIP.
- Do NOT duplicate information already in memory or daily notes.
- Be concise — compress, don't transcribe.`;

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
