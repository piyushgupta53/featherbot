import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evictLargeResult } from "./result-evictor.js";

const scratchPath = join(tmpdir(), "featherbot-evictor-test");

afterEach(() => {
	rmSync(scratchPath, { recursive: true, force: true });
});

describe("evictLargeResult", () => {
	it("returns result unchanged when under threshold", () => {
		const result = "short result";
		const out = evictLargeResult(result, { threshold: 100, scratchPath });
		expect(out).toBe(result);
	});

	it("evicts result when over threshold", () => {
		const result = "x".repeat(200);
		const out = evictLargeResult(result, { threshold: 100, scratchPath });

		expect(out).toContain("[Result too large (200 chars)");
		expect(out).toContain("=== HEAD ===");
		expect(out).toContain("=== TAIL ===");
		expect(out).toContain("scratch/.tool-results/");
		expect(out).toContain("[Full content:");
	});

	it("saves full content to file", () => {
		const result = "abc".repeat(100);
		const out = evictLargeResult(result, { threshold: 50, scratchPath });

		const match = out.match(/scratch\/\.tool-results\/(.+\.txt)/);
		expect(match).toBeTruthy();
		const filename = match?.[1] ?? "";
		const filePath = join(scratchPath, ".tool-results", filename);
		expect(existsSync(filePath)).toBe(true);
		expect(readFileSync(filePath, "utf-8")).toBe(result);
	});

	it("returns result at exactly threshold length unchanged", () => {
		const result = "a".repeat(100);
		const out = evictLargeResult(result, { threshold: 100, scratchPath });
		expect(out).toBe(result);
	});
});
