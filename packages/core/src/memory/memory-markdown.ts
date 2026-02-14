import type { Correction, ExtractionResult } from "./extraction-schema.js";

export interface ParsedMemory {
	facts: string[];
	patterns: string[];
	pending: string[];
}

const PLACEHOLDER_PATTERNS = [
	"(no entries yet)",
	"(none yet)",
	"(nothing yet)",
	"no entries yet",
	"none yet",
];

function isPlaceholder(line: string): boolean {
	const lower = line.toLowerCase().trim();
	return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
}

function extractBullets(lines: string[], startIdx: number, allHeaders: number[]): string[] {
	const nextHeader = allHeaders.find((h) => h > startIdx) ?? lines.length;
	const bullets: string[] = [];
	for (let i = startIdx + 1; i < nextHeader; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const trimmed = line.trim();
		if (trimmed.startsWith("- ")) {
			const text = trimmed.slice(2).trim();
			if (text && !isPlaceholder(text)) {
				bullets.push(text);
			}
		}
	}
	return bullets;
}

export function parseMemoryMarkdown(content: string): ParsedMemory {
	if (!content.trim()) {
		return { facts: [], patterns: [], pending: [] };
	}

	const lines = content.split("\n");
	const headerIndices: number[] = [];
	const headerNames: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const match = line.match(/^##\s+(.+)/);
		if (match?.[1]) {
			headerIndices.push(i);
			headerNames.push(match[1].trim().toLowerCase());
		}
	}

	let facts: string[] = [];
	let patterns: string[] = [];
	let pending: string[] = [];

	for (let j = 0; j < headerNames.length; j++) {
		const name = headerNames[j] as string;
		const idx = headerIndices[j] as number;
		if (name === "facts" || name.includes("fact")) {
			facts = extractBullets(lines, idx, headerIndices);
		} else if (name === "observed patterns" || name.includes("pattern")) {
			patterns = extractBullets(lines, idx, headerIndices);
		} else if (name === "pending" || name.includes("pending")) {
			pending = extractBullets(lines, idx, headerIndices);
		}
	}

	return { facts, patterns, pending };
}

export function renderMemoryMarkdown(memory: ParsedMemory): string {
	const sections: string[] = [];

	sections.push("## Facts");
	if (memory.facts.length > 0) {
		for (const f of memory.facts) {
			sections.push(`- ${f}`);
		}
	} else {
		sections.push("- (no entries yet)");
	}

	sections.push("");
	sections.push("## Observed Patterns");
	if (memory.patterns.length > 0) {
		for (const p of memory.patterns) {
			sections.push(`- ${p}`);
		}
	} else {
		sections.push("- (no entries yet)");
	}

	sections.push("");
	sections.push("## Pending");
	if (memory.pending.length > 0) {
		for (const p of memory.pending) {
			sections.push(`- ${p}`);
		}
	} else {
		sections.push("- (no entries yet)");
	}

	return `${sections.join("\n")}\n`;
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

function isResolved(pendingItem: string, resolvedList: string[]): boolean {
	const normalizedPending = normalize(pendingItem);
	return resolvedList.some((resolved) => {
		const normalizedResolved = normalize(resolved);
		// Fuzzy keyword match: check if the resolved item shares significant keywords
		const resolvedWords = normalizedResolved.split(" ").filter((w) => w.length > 3);
		const pendingWords = normalizedPending.split(" ").filter((w) => w.length > 3);
		const matchCount = resolvedWords.filter((w) => pendingWords.includes(w)).length;
		return (
			matchCount >= Math.min(2, pendingWords.length) ||
			normalizedPending.includes(normalizedResolved) ||
			normalizedResolved.includes(normalizedPending)
		);
	});
}

/**
 * Apply corrections by removing facts that match the "wrong" side
 * and adding the "right" side as a new fact.
 */
function applyCorrections(facts: string[], corrections: Correction[]): string[] {
	if (corrections.length === 0) return facts;

	let result = [...facts];
	for (const correction of corrections) {
		const normalizedWrong = normalize(correction.wrong);
		// Remove any fact that contains the wrong information
		result = result.filter((f) => {
			const normalizedFact = normalize(f);
			return !normalizedFact.includes(normalizedWrong) && !normalizedWrong.includes(normalizedFact);
		});
		// Add the correct information if not already present
		if (!isDuplicate(result, correction.right)) {
			result.push(correction.right);
		}
	}
	return result;
}

export function mergeExtraction(
	existing: ParsedMemory,
	extraction: ExtractionResult,
): ParsedMemory {
	// Apply corrections first — they take priority over existing facts
	const corrections = extraction.corrections ?? [];
	const facts = applyCorrections(existing.facts, corrections);
	for (const f of extraction.facts) {
		if (!isDuplicate(facts, f)) {
			facts.push(f);
		}
	}

	const patterns = [...existing.patterns];
	for (const p of extraction.patterns) {
		if (!isDuplicate(patterns, p)) {
			patterns.push(p);
		}
	}

	// Remove resolved pending items, then add new ones
	const pending = existing.pending.filter((p) => !isResolved(p, extraction.resolvedPending));
	for (const p of extraction.pending) {
		if (!isDuplicate(pending, p)) {
			pending.push(p);
		}
	}

	return { facts, patterns, pending };
}
