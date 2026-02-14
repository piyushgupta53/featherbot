import { generateStructuredWithFallback } from "../provider/structured-fallback.js";
import type { LLMMessage, LLMProvider } from "../provider/types.js";
import { appendToExistingNote, formatDailyNote } from "./daily-note.js";
import { CompactionResultSchema, ExtractionResultSchema } from "./extraction-schema.js";
import { mergeExtraction, parseMemoryMarkdown, renderMemoryMarkdown } from "./memory-markdown.js";
import { performRollup } from "./rollup.js";
import type { MemoryStore } from "./types.js";

export interface MemoryExtractorOptions {
	provider: LLMProvider;
	memoryStore: MemoryStore;
	getHistory: (sessionKey: string) => LLMMessage[];
	idleMs?: number;
	maxAgeMs?: number;
	compactionThreshold?: number;
	enabled?: boolean;
	model?: string;
}

export function buildExtractionPrompt(currentMemory: string): string {
	return `You are a memory extraction assistant. Analyze the conversation above and extract structured information.

Current MEMORY.md content:
---
${currentMemory || "(empty)"}
---

Extract the following from the conversation:

1. **facts**: Personal details, projects, preferences, things the user wants remembered. Only include NEW facts not already in MEMORY.md.
2. **patterns**: Recurring behaviors or preferences observed. Only include NEW patterns.
3. **pending**: Follow-ups, reminders, things to circle back on. Only include NEW pending items.
4. **resolvedPending**: Any pending items from MEMORY.md that have been completed or are no longer relevant.
5. **corrections**: HIGHEST PRIORITY — If the user corrected the agent or contradicted something in MEMORY.md (e.g., "No, I prefer Python not JS", "Actually my name is...", "That's wrong, I..."), extract each correction as { wrong: "the incorrect belief", right: "the correct information" }. Corrections MUST override existing facts.
6. **observations**: Notable observations from this conversation for the daily note, each with a priority:
   - "red": Important — decisions made, action items, explicit requests to remember, strong preferences, CORRECTIONS
   - "yellow": Moderate — topics discussed, tasks worked on, notable context
   - "green": Minor — informational details, passing mentions

Set "skip" to true ONLY if the conversation is truly empty (just greetings with no substance).
Be concise — compress, don't transcribe.
IMPORTANT: Corrections and user feedback take absolute priority. If the user says "no", "actually", "that's wrong", "I prefer X not Y", or contradicts a stored fact, you MUST capture it as a correction.`;
}

function buildCompactionPrompt(currentMemory: string): string {
	return `You are a memory compaction assistant. The MEMORY.md file has grown too large and needs consolidation.

Current MEMORY.md content:
---
${currentMemory}
---

Consolidate the memory:
1. Merge duplicate or overlapping facts into single entries
2. Remove outdated or contradicted information (keep the newer version)
3. Combine related patterns
4. Remove pending items that appear resolved based on facts
5. Keep the same categories: facts, patterns, pending

Return the compacted version. Aim to reduce size by ~30% while preserving all important information.`;
}

const CORRECTION_PATTERNS = [
	/\bno[,.]?\s+(i|my|it'?s|that'?s|actually)\b/i,
	/\bactually[,.]?\s+(i|my|it'?s|that'?s)\b/i,
	/\bthat'?s\s+(wrong|incorrect|not right|not true)\b/i,
	/\bi\s+prefer\s+\w+\s+not\b/i,
	/\bnot\s+\w+[,.]?\s+(i|it'?s)\s+(prefer|like|use|want)\b/i,
	/\bstop\s+(calling|saying|using)\b/i,
	/\bdon'?t\s+(call|say)\s+me\b/i,
	/\bmy\s+name\s+is\s+(actually|really)\b/i,
	/\bcorrect(ion)?:/i,
	/\bremember\s+that\s+i\b/i,
];

/**
 * Detect whether a message contains correction signals that should
 * trigger urgent memory extraction.
 */
export function containsCorrectionSignal(text: string): boolean {
	return CORRECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export class MemoryExtractor {
	private readonly provider: LLMProvider;
	private readonly memoryStore: MemoryStore;
	private readonly getHistoryFn: (sessionKey: string) => LLMMessage[];
	private readonly idleMs: number;
	private readonly maxAgeMs: number;
	private readonly compactionThreshold: number;
	private readonly enabled: boolean;
	private readonly model?: string;
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly running = new Set<string>();
	private readonly lastExtraction = new Map<string, number>();
	private readonly firstSeen = new Map<string, number>();
	private memoryWriteQueue: Promise<void> = Promise.resolve();

	constructor(options: MemoryExtractorOptions) {
		this.provider = options.provider;
		this.memoryStore = options.memoryStore;
		this.getHistoryFn = options.getHistory;
		this.idleMs = options.idleMs ?? 300_000;
		this.maxAgeMs = options.maxAgeMs ?? 1_800_000;
		this.compactionThreshold = options.compactionThreshold ?? 4000;
		this.enabled = options.enabled ?? true;
		this.model = options.model;
	}

	scheduleExtraction(sessionKey: string): void {
		if (!this.enabled) return;
		const now = Date.now();
		if (!this.firstSeen.has(sessionKey)) {
			this.firstSeen.set(sessionKey, now);
		}

		const existing = this.timers.get(sessionKey);
		if (existing !== undefined) {
			clearTimeout(existing);
		}

		const timer = setTimeout(() => {
			this.timers.delete(sessionKey);
			void this.extract(sessionKey);
		}, this.idleMs);

		this.timers.set(sessionKey, timer);

		// Check max-age: force extraction if it's been too long
		const lastTime = this.lastExtraction.get(sessionKey);
		const firstTime = this.firstSeen.get(sessionKey);
		const baseTime = lastTime ?? firstTime;
		if (baseTime !== undefined && now - baseTime >= this.maxAgeMs) {
			clearTimeout(timer);
			this.timers.delete(sessionKey);
			void this.extract(sessionKey);
		}
	}

	/**
	 * Schedule an urgent extraction with a short delay (60s) when correction
	 * signals are detected in user messages.
	 */
	scheduleUrgentExtraction(sessionKey: string): void {
		if (!this.enabled) return;

		const existing = this.timers.get(sessionKey);
		if (existing !== undefined) {
			clearTimeout(existing);
		}

		const urgentMs = 60_000;
		const timer = setTimeout(() => {
			this.timers.delete(sessionKey);
			void this.extract(sessionKey);
		}, urgentMs);

		this.timers.set(sessionKey, timer);
		console.log(`[memory] urgent extraction scheduled for ${sessionKey} (60s)`);
	}

	async dispose(): Promise<void> {
		// Clear all idle timers
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}

		// Collect sessions that have pending timers (not yet extracted)
		const pendingSessions = [...this.timers.keys()];
		this.timers.clear();
		this.lastExtraction.clear();
		this.firstSeen.clear();
		this.running.clear();

		// Force-extract all pending sessions with a timeout
		if (pendingSessions.length > 0) {
			const extractPromises = pendingSessions.map((key) => this.extract(key));
			await Promise.race([
				Promise.allSettled(extractPromises),
				new Promise((resolve) => setTimeout(resolve, 10_000)),
			]);
		}
	}

	private async extract(sessionKey: string): Promise<void> {
		if (this.running.has(sessionKey)) return;
		this.running.add(sessionKey);
		console.log(`[memory] extracting observations for ${sessionKey}...`);
		console.log("[metrics] memory_extraction_attempt");

		try {
			// 1. Get conversation history
			const history = this.getHistoryFn(sessionKey);
			const textMessages = history
				.filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
				.slice(-50);

			if (textMessages.length === 0) {
				console.log(`[memory] extraction skipped for ${sessionKey} (no messages)`);
				console.log("[metrics] memory_extraction_skipped_empty");
				return;
			}

			// 2. Read current MEMORY.md
			const currentMemory = await this.memoryStore.readMemoryFile();

			// 3. Call generateStructured for extraction
			const extractionPrompt = buildExtractionPrompt(currentMemory);
			const messages: LLMMessage[] = [
				{ role: "system", content: extractionPrompt },
				...textMessages,
			];

			const result = await generateStructuredWithFallback({
				provider: this.provider,
				model: this.model,
				messages,
				schema: ExtractionResultSchema,
				schemaName: "ExtractionResult",
				schemaDescription: "Structured memory extraction from conversation",
				temperature: 0.3,
			});

			const extraction = result.object;

			// 4. Check skip
			if (
				extraction.skip &&
				extraction.facts.length === 0 &&
				extraction.observations.length === 0
			) {
				console.log(`[memory] extraction skipped for ${sessionKey} (nothing new)`);
				console.log("[metrics] memory_extraction_skipped_noop");
				this.lastExtraction.set(sessionKey, Date.now());
				this.firstSeen.delete(sessionKey);
				return;
			}

			// 5-9. Serialize MEMORY.md writes to avoid cross-session clobbering.
			await this.enqueueMemoryWrite(async () => {
				const latestMemory = await this.memoryStore.readMemoryFile();
				const parsed = parseMemoryMarkdown(latestMemory);
				const merged = mergeExtraction(parsed, extraction);
				const rendered = renderMemoryMarkdown(merged);
				await this.memoryStore.writeMemoryFile(rendered);

				// 6. Create/update daily note if observations exist
				if (extraction.observations.length > 0) {
					const todayFilename = this.memoryStore.getDailyNotePath().split(/[\\/]/).pop() ?? "";
					const today = /^\d{4}-\d{2}-\d{2}\.md$/.test(todayFilename)
						? todayFilename.slice(0, 10)
						: new Date().toISOString().slice(0, 10);
					const existingNote = await this.memoryStore.readDailyNote();
					let noteContent: string;
					if (existingNote.trim()) {
						noteContent = appendToExistingNote(existingNote, sessionKey, extraction.observations);
					} else {
						noteContent = formatDailyNote(today, sessionKey, extraction.observations);
					}
					await this.memoryStore.writeDailyNote(noteContent);
				}

				// 7. Perform rollup (promote old daily note 🔴/selected 🟡 items)
				try {
					const rollupResult = await performRollup(this.memoryStore);
					if (rollupResult.promotedCount > 0) {
						console.log(
							`[memory] rollup promoted ${rollupResult.promotedCount} item(s), deleted ${rollupResult.deletedNotes.length} note(s)`,
						);
					}
				} catch (err) {
					console.warn("[memory] rollup failed:", err);
				}

				// 8. Compaction if MEMORY.md is too large
				const updatedMemory = await this.memoryStore.readMemoryFile();
				if (updatedMemory.length > this.compactionThreshold) {
					try {
						await this.compact(updatedMemory);
					} catch (err) {
						console.warn("[memory] compaction failed:", err);
					}
				}

				// 9. Cleanup old notes
				await this.cleanupOldNotes();
			});

			this.lastExtraction.set(sessionKey, Date.now());
			this.firstSeen.delete(sessionKey);

			const factCount = extraction.facts.length;
			const obsCount = extraction.observations.length;
			console.log(
				`[memory] extraction complete for ${sessionKey} (${factCount} fact(s), ${obsCount} observation(s))`,
			);
			console.log("[metrics] memory_extraction_success");
		} catch (err) {
			console.error(`[memory] extraction failed for ${sessionKey}:`, err);
			console.log("[metrics] memory_extraction_failure");
		} finally {
			this.running.delete(sessionKey);
		}
	}

	private async compact(currentContent: string): Promise<void> {
		const prompt = buildCompactionPrompt(currentContent);
		const result = await generateStructuredWithFallback({
			provider: this.provider,
			model: this.model,
			messages: [{ role: "user", content: prompt }],
			schema: CompactionResultSchema,
			schemaName: "CompactionResult",
			schemaDescription: "Compacted memory content",
			temperature: 0.2,
		});

		const compacted = result.object;
		const rendered = renderMemoryMarkdown({
			facts: compacted.facts,
			patterns: compacted.patterns,
			pending: compacted.pending,
		});
		await this.memoryStore.writeMemoryFile(rendered);
		console.log("[memory] compaction complete");
	}

	private async cleanupOldNotes(): Promise<void> {
		try {
			const notes = await this.memoryStore.listDailyNotes();
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - 30);
			const cutoffStr = cutoff.toISOString().slice(0, 10);

			for (const note of notes) {
				const dateStr = note.slice(0, 10);
				if (dateStr < cutoffStr) {
					const date = new Date(`${dateStr}T00:00:00Z`);
					await this.memoryStore.deleteDailyNote(date);
				}
			}
		} catch {
			// Best-effort cleanup — swallow errors
		}
	}

	private async enqueueMemoryWrite<T>(task: () => Promise<T>): Promise<T> {
		let release: (() => void) | undefined;
		const next = new Promise<void>((resolve) => {
			release = resolve;
		});
		const prev = this.memoryWriteQueue;
		this.memoryWriteQueue = prev.then(
			() => next,
			() => next,
		);
		await prev;
		try {
			return await task();
		} finally {
			release?.();
		}
	}
}
