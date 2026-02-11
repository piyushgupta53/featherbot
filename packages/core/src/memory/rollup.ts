import { extractRollupCandidates } from "./daily-note.js";
import { parseMemoryMarkdown, renderMemoryMarkdown } from "./memory-markdown.js";
import type { MemoryStore } from "./types.js";

export interface RollupResult {
	promotedCount: number;
	deletedNotes: string[];
}

function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function isDuplicate(existing: string[], newItem: string): boolean {
	const normalizedNew = normalize(newItem);
	return existing.some((e) => {
		const normalizedExisting = normalize(e);
		return (
			normalizedExisting === normalizedNew ||
			normalizedExisting.includes(normalizedNew) ||
			normalizedNew.includes(normalizedExisting)
		);
	});
}

export async function performRollup(store: MemoryStore): Promise<RollupResult> {
	let promotedCount = 0;
	const deletedNotes: string[] = [];

	// Process notes from 1-3 days ago
	const importantItems: string[] = [];
	const notesToDelete: Date[] = [];

	for (let daysAgo = 1; daysAgo <= 3; daysAgo++) {
		const date = new Date();
		date.setDate(date.getDate() - daysAgo);

		const noteContent = await store.readDailyNote(date);
		if (!noteContent.trim()) continue;

		const items = extractRollupCandidates(noteContent);
		if (items.length > 0) {
			importantItems.push(...items);
		}
		notesToDelete.push(date);
	}

	if (importantItems.length === 0 && notesToDelete.length === 0) {
		return { promotedCount: 0, deletedNotes: [] };
	}

	// Read + parse current MEMORY.md
	const memoryContent = await store.readMemoryFile();
	const memory = parseMemoryMarkdown(memoryContent);

	// Append important items to Facts with dedup
	for (const item of importantItems) {
		if (!isDuplicate(memory.facts, item)) {
			memory.facts.push(item);
			promotedCount++;
		}
	}

	// Write back if we promoted anything
	if (promotedCount > 0) {
		await store.writeMemoryFile(renderMemoryMarkdown(memory));
	}

	// Delete processed notes
	for (const date of notesToDelete) {
		await store.deleteDailyNote(date);
		deletedNotes.push(date.toISOString().slice(0, 10));
	}

	return { promotedCount, deletedNotes };
}
