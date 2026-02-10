interface AgentLoopLike {
	processDirect(
		message: string,
		options?: { systemPrompt?: string; sessionKey?: string },
	): Promise<{
		text: string;
		toolCalls?: Array<{ toolName: string }>;
	}>;
}

export interface MemoryExtractorOptions {
	agentLoop: AgentLoopLike;
	idleMs?: number;
	enabled?: boolean;
}

const EXTRACTION_PROMPT = `Review the conversation above and produce a compressed observation log.

## Step 1 — Daily Note Observations

Write observations to today's daily note (memory/YYYY-MM-DD.md):
1. Use read_file to check if the daily note already exists.
2. If it does NOT exist, use write_file to create it with a date heading (e.g., "# 2026-02-10") followed by your session header and observations.
3. If it DOES exist, use edit_file to append your session header and observations at the end of the file.

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
- You MUST use write_file or edit_file to persist observations — just responding with text does nothing.
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
		console.log(`[memory] extracting observations for ${sessionKey}...`);
		try {
			const result = await this.agentLoop.processDirect(EXTRACTION_PROMPT, {
				sessionKey,
			});
			const skipped = result.text.trim().toUpperCase() === "SKIP";
			if (skipped) {
				console.log(`[memory] extraction skipped for ${sessionKey} (nothing new)`);
			} else {
				const writes = (result.toolCalls ?? []).filter(
					(tc) => tc.toolName === "write_file" || tc.toolName === "edit_file",
				);
				if (writes.length > 0) {
					console.log(
						`[memory] extraction complete for ${sessionKey} (${writes.length} file write(s))`,
					);
				} else {
					console.log(`[memory] extraction returned text but wrote no files for ${sessionKey}`);
				}
			}
		} catch (err) {
			console.error(`[memory] extraction failed for ${sessionKey}:`, err);
		} finally {
			this.running.delete(sessionKey);
		}
	}
}
