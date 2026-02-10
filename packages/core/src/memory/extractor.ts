import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

interface AgentLoopLike {
	processDirect(
		message: string,
		options?: { systemPrompt?: string; sessionKey?: string; skipHistory?: boolean },
	): Promise<{
		text: string;
		toolResults?: Array<{ toolName: string; content: string }>;
	}>;
}

export interface MemoryExtractorOptions {
	agentLoop: AgentLoopLike;
	idleMs?: number;
	enabled?: boolean;
	workspacePath?: string;
}

export function buildExtractionPrompt(sessionKey: string, date: string): string {
	return `Review the conversation above. You have TWO independent jobs. Do BOTH.

## Job 1 — Update MEMORY.md (long-term memory)

This is the most important job. MEMORY.md is permanent — it carries across all future conversations.

1. Use read_file to read memory/MEMORY.md.
2. Review the conversation for ANY of these:
   - Personal details, projects, hobbies, interests → add to **Facts**
   - Recurring behaviors or preferences → add to **Observed Patterns**
   - Follow-ups, deadlines, things to circle back on → add to **Pending**
3. If there are items in the conversation not already in MEMORY.md, use edit_file to add them.
4. Even if a previous extraction wrote to the daily note, MEMORY.md may still be missing those facts. Always check.

## Job 2 — Update daily note (memory/${date}.md)

1. Use read_file to check if memory/${date}.md already exists.
2. If it exists, check if the section "## ${sessionKey}" is already present.
   - If the section exists with the same observations, do NOT rewrite it.
   - If the section is missing or has new observations to add, read the content, merge, and use write_file.
3. If the file does NOT exist, use write_file to create it with heading "# ${date}" followed by your observations.

Use the session header "## ${sessionKey}" then list priority-tagged observations:

- 🔴 Important — decisions made, action items, explicit requests to remember, strong preferences
- 🟡 Moderate — topics discussed, tasks worked on, notable context, preferences expressed
- 🟢 Minor — informational details, small talk, passing mentions

Keep each observation to one concise line.

## Rules

- Only SKIP if the conversation is truly empty (just "hi" with no follow-up or substantive content).
- You MUST use write_file or edit_file to persist — just responding with text does nothing.
- Be concise — compress, don't transcribe.`;
}

export class MemoryExtractor {
	private readonly agentLoop: AgentLoopLike;
	private readonly idleMs: number;
	private readonly enabled: boolean;
	private readonly workspacePath?: string;
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly running = new Set<string>();

	constructor(options: MemoryExtractorOptions) {
		this.agentLoop = options.agentLoop;
		this.idleMs = options.idleMs ?? 300_000;
		this.enabled = options.enabled ?? true;
		this.workspacePath = options.workspacePath;
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
			const today = new Date().toISOString().slice(0, 10);
			const prompt = buildExtractionPrompt(sessionKey, today);
			const result = await this.agentLoop.processDirect(prompt, {
				sessionKey,
				skipHistory: true,
			});
			const skipped = result.text.trim().toUpperCase() === "SKIP";
			if (skipped) {
				console.log(`[memory] extraction skipped for ${sessionKey} (nothing new)`);
			} else {
				const results = result.toolResults ?? [];
				const writes = results.filter(
					(tr) => tr.toolName === "write_file" || tr.toolName === "edit_file",
				);
				const failedWrites = writes.filter((tr) => tr.content.startsWith("Error"));
				const successfulWrites = writes.length - failedWrites.length;

				if (failedWrites.length > 0) {
					console.warn(
						`[memory] extraction had ${failedWrites.length} failed write(s) for ${sessionKey}`,
					);
				}
				if (successfulWrites > 0) {
					console.log(
						`[memory] extraction complete for ${sessionKey} (${successfulWrites} file write(s))`,
					);
				} else if (writes.length === 0) {
					console.warn(`[memory] extraction returned text but wrote no files for ${sessionKey}`);
				}
			}

			if (this.workspacePath) {
				await this.cleanupOldNotes();
			}
		} catch (err) {
			console.error(`[memory] extraction failed for ${sessionKey}:`, err);
		} finally {
			this.running.delete(sessionKey);
		}
	}

	private async cleanupOldNotes(): Promise<void> {
		if (!this.workspacePath) return;
		try {
			const memoryDir = join(this.workspacePath, "memory");
			const files = await readdir(memoryDir);
			const datePattern = /^\d{4}-\d{2}-\d{2}\.md$/;
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - 30);
			const cutoffStr = cutoff.toISOString().slice(0, 10);

			for (const file of files) {
				if (datePattern.test(file)) {
					const dateStr = file.slice(0, 10);
					if (dateStr < cutoffStr) {
						await unlink(join(memoryDir, file));
					}
				}
			}
		} catch {
			// Best-effort cleanup — swallow errors
		}
	}
}
