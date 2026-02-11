import type { ExtractionResult } from "./extraction-schema.js";

const PRIORITY_EMOJI: Record<string, string> = {
	red: "🔴",
	yellow: "🟡",
	green: "🟢",
};

export function formatDailyNote(
	date: string,
	sessionKey: string,
	observations: ExtractionResult["observations"],
): string {
	const lines = [`# ${date}`, "", `## ${sessionKey}`];
	for (const obs of observations) {
		lines.push(`- ${PRIORITY_EMOJI[obs.priority]} ${obs.text}`);
	}
	return `${lines.join("\n")}\n`;
}

export function appendToExistingNote(
	existingContent: string,
	sessionKey: string,
	observations: ExtractionResult["observations"],
): string {
	const sessionHeader = `## ${sessionKey}`;
	const bulletLines = observations.map((obs) => `- ${PRIORITY_EMOJI[obs.priority]} ${obs.text}`);
	const dedup = (lines: string[]): string[] => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const line of lines) {
			const key = line.trim().toLowerCase();
			if (!key || seen.has(key)) continue;
			seen.add(key);
			out.push(line);
		}
		return out;
	};

	const lines = existingContent.split("\n");
	const headerIdx = lines.findIndex((l) => l.trim() === sessionHeader);

	if (headerIdx === -1) {
		// Append new section
		const newSection = `${sessionHeader}\n${dedup(bulletLines).join("\n")}`;
		const trimmed = existingContent.trimEnd();
		return `${trimmed}\n\n${newSection}\n`;
	}

	// Find the end of the existing section (next ## header or end of file)
	let endIdx = lines.length;
	for (let i = headerIdx + 1; i < lines.length; i++) {
		if (lines[i]?.match(/^##\s/)) {
			endIdx = i;
			break;
		}
	}

	const existingBullets: string[] = [];
	for (let i = headerIdx + 1; i < endIdx; i++) {
		const line = lines[i]?.trim();
		if (line?.startsWith("- ")) {
			existingBullets.push(line);
		}
	}

	// Append and deduplicate instead of replacing the session block.
	const mergedBullets = dedup([...existingBullets, ...bulletLines]);
	const newSection = `${sessionHeader}\n${mergedBullets.join("\n")}`;

	const before = lines.slice(0, headerIdx);
	const after = lines.slice(endIdx);
	const result = [...before, newSection, ...after];
	return `${result.join("\n").trimEnd()}\n`;
}

export function extractImportantItems(noteContent: string): string[] {
	const items: string[] = [];
	const lines = noteContent.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("- 🔴")) {
			const text = trimmed.slice(4).trim();
			if (text) {
				items.push(text);
			}
		}
	}
	return items;
}

export function extractRollupCandidates(noteContent: string): string[] {
	const items: string[] = [];
	const lines = noteContent.split("\n");
	const yellowSignal =
		/\b(prefers?|usually|always|every|routine|habit|deadline|appointment|meeting|timezone|important|project|goal)\b/i;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("- 🔴")) {
			const text = trimmed.slice(4).trim();
			if (text) items.push(text);
			continue;
		}
		if (trimmed.startsWith("- 🟡")) {
			const text = trimmed.slice(4).trim();
			if (text && yellowSignal.test(text)) {
				items.push(text);
			}
		}
	}
	return items;
}
