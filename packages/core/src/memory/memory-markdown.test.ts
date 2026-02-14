import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "./extraction-schema.js";
import { mergeExtraction, parseMemoryMarkdown, renderMemoryMarkdown } from "./memory-markdown.js";

describe("parseMemoryMarkdown", () => {
	it("returns empty arrays for empty content", () => {
		expect(parseMemoryMarkdown("")).toEqual({ facts: [], patterns: [], pending: [] });
	});

	it("returns empty arrays for whitespace-only content", () => {
		expect(parseMemoryMarkdown("   \n  \n  ")).toEqual({ facts: [], patterns: [], pending: [] });
	});

	it("parses template with placeholder entries as empty", () => {
		const content = `## Facts
- (no entries yet)

## Observed Patterns
- (no entries yet)

## Pending
- (no entries yet)
`;
		expect(parseMemoryMarkdown(content)).toEqual({ facts: [], patterns: [], pending: [] });
	});

	it("parses populated MEMORY.md", () => {
		const content = `## Facts
- User name is Alice
- Lives in San Francisco

## Observed Patterns
- Prefers concise answers
- Works late at night

## Pending
- Follow up on domain renewal
`;
		const result = parseMemoryMarkdown(content);
		expect(result.facts).toEqual(["User name is Alice", "Lives in San Francisco"]);
		expect(result.patterns).toEqual(["Prefers concise answers", "Works late at night"]);
		expect(result.pending).toEqual(["Follow up on domain renewal"]);
	});

	it("handles sections with alternative header names", () => {
		const content = `## User Facts
- Name is Bob

## Behavioral Patterns
- Always uses dark mode
`;
		const result = parseMemoryMarkdown(content);
		expect(result.facts).toEqual(["Name is Bob"]);
		expect(result.patterns).toEqual(["Always uses dark mode"]);
	});

	it("ignores non-bullet lines within sections", () => {
		const content = `## Facts
Some intro text
- Actual fact here
Another paragraph
- Second fact
`;
		const result = parseMemoryMarkdown(content);
		expect(result.facts).toEqual(["Actual fact here", "Second fact"]);
	});
});

describe("renderMemoryMarkdown", () => {
	it("renders empty memory with placeholders", () => {
		const result = renderMemoryMarkdown({ facts: [], patterns: [], pending: [] });
		expect(result).toContain("## Facts\n- (no entries yet)");
		expect(result).toContain("## Observed Patterns\n- (no entries yet)");
		expect(result).toContain("## Pending\n- (no entries yet)");
	});

	it("renders populated memory", () => {
		const result = renderMemoryMarkdown({
			facts: ["Name is Alice"],
			patterns: ["Prefers TypeScript"],
			pending: ["Domain renewal"],
		});
		expect(result).toContain("## Facts\n- Name is Alice");
		expect(result).toContain("## Observed Patterns\n- Prefers TypeScript");
		expect(result).toContain("## Pending\n- Domain renewal");
	});

	it("round-trips correctly", () => {
		const original = {
			facts: ["Fact one", "Fact two"],
			patterns: ["Pattern A"],
			pending: ["Pending item"],
		};
		const rendered = renderMemoryMarkdown(original);
		const parsed = parseMemoryMarkdown(rendered);
		expect(parsed).toEqual(original);
	});
});

describe("mergeExtraction", () => {
	const emptyMemory = { facts: [], patterns: [], pending: [] };

	it("adds new facts to empty memory", () => {
		const extraction: ExtractionResult = {
			skip: false,
			facts: ["User name is Alice"],
			patterns: [],
			pending: [],
			resolvedPending: [],
			corrections: [],
			observations: [],
		};
		const result = mergeExtraction(emptyMemory, extraction);
		expect(result.facts).toEqual(["User name is Alice"]);
	});

	it("deduplicates exact matches", () => {
		const existing = { facts: ["User name is Alice"], patterns: [], pending: [] };
		const extraction: ExtractionResult = {
			skip: false,
			facts: ["User name is Alice"],
			patterns: [],
			pending: [],
			resolvedPending: [],
			corrections: [],
			observations: [],
		};
		const result = mergeExtraction(existing, extraction);
		expect(result.facts).toEqual(["User name is Alice"]);
	});

	it("deduplicates by substring match", () => {
		const existing = {
			facts: ["User name is Alice and she lives in SF"],
			patterns: [],
			pending: [],
		};
		const extraction: ExtractionResult = {
			skip: false,
			facts: ["User name is Alice"],
			patterns: [],
			pending: [],
			resolvedPending: [],
			corrections: [],
			observations: [],
		};
		const result = mergeExtraction(existing, extraction);
		expect(result.facts).toEqual(["User name is Alice and she lives in SF"]);
	});

	it("adds truly new items", () => {
		const existing = { facts: ["User name is Alice"], patterns: [], pending: [] };
		const extraction: ExtractionResult = {
			skip: false,
			facts: ["Works at Anthropic"],
			patterns: ["Prefers TypeScript"],
			pending: ["Domain renewal"],
			resolvedPending: [],
			corrections: [],
			observations: [],
		};
		const result = mergeExtraction(existing, extraction);
		expect(result.facts).toEqual(["User name is Alice", "Works at Anthropic"]);
		expect(result.patterns).toEqual(["Prefers TypeScript"]);
		expect(result.pending).toEqual(["Domain renewal"]);
	});

	it("resolves pending items", () => {
		const existing = {
			facts: [],
			patterns: [],
			pending: ["Follow up on domain renewal", "Check server uptime"],
		};
		const extraction: ExtractionResult = {
			skip: false,
			facts: [],
			patterns: [],
			pending: [],
			resolvedPending: ["domain renewal is done"],
			corrections: [],
			observations: [],
		};
		const result = mergeExtraction(existing, extraction);
		expect(result.pending).toEqual(["Check server uptime"]);
	});

	it("handles simultaneous add and resolve of pending", () => {
		const existing = {
			facts: [],
			patterns: [],
			pending: ["Old pending task"],
		};
		const extraction: ExtractionResult = {
			skip: false,
			facts: [],
			patterns: [],
			pending: ["New pending task"],
			resolvedPending: ["old pending task"],
			corrections: [],
			observations: [],
		};
		const result = mergeExtraction(existing, extraction);
		expect(result.pending).toEqual(["New pending task"]);
	});

	it("applies corrections by replacing contradicted facts", () => {
		const existing = {
			facts: ["User prefers JavaScript", "Lives in San Francisco"],
			patterns: [],
			pending: [],
		};
		const extraction: ExtractionResult = {
			skip: false,
			facts: [],
			patterns: [],
			pending: [],
			resolvedPending: [],
			corrections: [{ wrong: "prefers JavaScript", right: "User prefers Python" }],
			observations: [],
		};
		const result = mergeExtraction(existing, extraction);
		expect(result.facts).toEqual(["Lives in San Francisco", "User prefers Python"]);
	});
});
