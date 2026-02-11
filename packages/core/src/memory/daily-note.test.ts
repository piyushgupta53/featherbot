import { describe, expect, it } from "vitest";
import {
	appendToExistingNote,
	extractImportantItems,
	extractRollupCandidates,
	formatDailyNote,
} from "./daily-note.js";

describe("formatDailyNote", () => {
	it("creates a new daily note with date heading and session section", () => {
		const result = formatDailyNote("2026-02-10", "telegram:123", [
			{ text: "User decided to switch to TypeScript", priority: "red" },
			{ text: "Discussed weather briefly", priority: "green" },
		]);
		expect(result).toBe(
			"# 2026-02-10\n\n## telegram:123\n- 🔴 User decided to switch to TypeScript\n- 🟢 Discussed weather briefly\n",
		);
	});

	it("handles empty observations", () => {
		const result = formatDailyNote("2026-02-10", "terminal:cli", []);
		expect(result).toBe("# 2026-02-10\n\n## terminal:cli\n");
	});

	it("uses correct emoji for each priority", () => {
		const result = formatDailyNote("2026-02-10", "session", [
			{ text: "red item", priority: "red" },
			{ text: "yellow item", priority: "yellow" },
			{ text: "green item", priority: "green" },
		]);
		expect(result).toContain("🔴 red item");
		expect(result).toContain("🟡 yellow item");
		expect(result).toContain("🟢 green item");
	});
});

describe("appendToExistingNote", () => {
	it("appends a new session section to existing note", () => {
		const existing = "# 2026-02-10\n\n## telegram:123\n- 🔴 First observation\n";
		const result = appendToExistingNote(existing, "telegram:456", [
			{ text: "New observation", priority: "yellow" },
		]);
		expect(result).toContain("## telegram:123\n- 🔴 First observation");
		expect(result).toContain("## telegram:456\n- 🟡 New observation");
	});

	it("appends to existing session section without losing prior observations", () => {
		const existing = "# 2026-02-10\n\n## telegram:123\n- 🔴 Old observation\n";
		const result = appendToExistingNote(existing, "telegram:123", [
			{ text: "Updated observation", priority: "red" },
		]);
		expect(result).toContain("Old observation");
		expect(result).toContain("🔴 Updated observation");
	});

	it("preserves other sections while appending into target session", () => {
		const existing =
			"# 2026-02-10\n\n## session-a\n- 🟢 A stuff\n\n## session-b\n- 🟡 B stuff\n\n## session-c\n- 🔴 C stuff\n";
		const result = appendToExistingNote(existing, "session-b", [
			{ text: "New B stuff", priority: "red" },
		]);
		expect(result).toContain("## session-a\n- 🟢 A stuff");
		expect(result).toContain("## session-b\n- 🟡 B stuff\n- 🔴 New B stuff");
		expect(result).toContain("## session-c\n- 🔴 C stuff");
	});
});

describe("extractImportantItems", () => {
	it("extracts lines with 🔴 emoji", () => {
		const content =
			"# 2026-02-10\n\n## telegram:123\n- 🔴 Important decision\n- 🟡 Moderate thing\n- 🟢 Minor detail\n- 🔴 Another important item\n";
		const result = extractImportantItems(content);
		expect(result).toEqual(["Important decision", "Another important item"]);
	});

	it("returns empty array when no red items", () => {
		const content = "# 2026-02-10\n\n## session\n- 🟡 Just moderate\n- 🟢 Just minor\n";
		expect(extractImportantItems(content)).toEqual([]);
	});

	it("returns empty array for empty content", () => {
		expect(extractImportantItems("")).toEqual([]);
	});

	it("handles lines with only emoji (no text after)", () => {
		const content = "- 🔴\n- 🔴 real item\n";
		expect(extractImportantItems(content)).toEqual(["real item"]);
	});
});

describe("extractRollupCandidates", () => {
	it("includes red and high-signal yellow items", () => {
		const content =
			"# 2026-02-10\n\n## session\n- 🔴 Important decision\n- 🟡 User prefers concise summaries\n- 🟡 Chatted casually\n";
		expect(extractRollupCandidates(content)).toEqual([
			"Important decision",
			"User prefers concise summaries",
		]);
	});
});
