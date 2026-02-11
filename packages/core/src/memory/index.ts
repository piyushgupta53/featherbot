import { FileMemoryStore } from "./file-store.js";
import type { MemoryStore } from "./types.js";

export function createMemoryStore(workspacePath: string, timezone?: string): MemoryStore {
	return new FileMemoryStore(workspacePath, timezone);
}

export { FileMemoryStore };
export { MemoryExtractor } from "./extractor.js";
export type { MemoryExtractorOptions } from "./extractor.js";
export type { MemoryStore };
export { ExtractionResultSchema, CompactionResultSchema } from "./extraction-schema.js";
export type { ExtractionResult, CompactionResult } from "./extraction-schema.js";
export {
	parseMemoryMarkdown,
	renderMemoryMarkdown,
	mergeExtraction,
} from "./memory-markdown.js";
export type { ParsedMemory } from "./memory-markdown.js";
export { formatDailyNote, appendToExistingNote, extractImportantItems } from "./daily-note.js";
export { performRollup } from "./rollup.js";
export type { RollupResult } from "./rollup.js";
