import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { isWithinWorkspace, resolvePath, validatePath } from "./path-utils.js";

const WORKSPACE = "/home/user/workspace";

describe("resolvePath", () => {
	it("returns absolute paths as-is (normalized)", () => {
		expect(resolvePath("/etc/hosts", WORKSPACE)).toBe("/etc/hosts");
	});

	it("resolves relative paths against workspace", () => {
		expect(resolvePath("src/index.ts", WORKSPACE)).toBe(`${WORKSPACE}/src/index.ts`);
	});

	it("expands ~ to homedir", () => {
		const result = resolvePath("~/documents/file.txt", WORKSPACE);
		expect(result).toBe(resolve(homedir(), "documents/file.txt"));
	});

	it("normalizes ../ in absolute paths", () => {
		expect(resolvePath("/home/user/workspace/../other/file.txt", WORKSPACE)).toBe(
			"/home/user/other/file.txt",
		);
	});

	it("normalizes ../ in relative paths", () => {
		expect(resolvePath("../other/file.txt", WORKSPACE)).toBe("/home/user/other/file.txt");
	});
});

describe("isWithinWorkspace", () => {
	it("returns true for paths inside workspace", () => {
		expect(isWithinWorkspace(`${WORKSPACE}/src/file.ts`, WORKSPACE)).toBe(true);
	});

	it("returns true for the workspace directory itself", () => {
		expect(isWithinWorkspace(WORKSPACE, WORKSPACE)).toBe(true);
	});

	it("returns false for paths outside workspace", () => {
		expect(isWithinWorkspace("/etc/passwd", WORKSPACE)).toBe(false);
	});

	it("returns false for sibling paths with shared prefix", () => {
		expect(isWithinWorkspace(`${WORKSPACE}-other/file.ts`, WORKSPACE)).toBe(false);
	});

	it("returns false for parent directory", () => {
		expect(isWithinWorkspace("/home/user", WORKSPACE)).toBe(false);
	});

	it("handles paths with ../ by resolving first", () => {
		const traversalPath = resolve(`${WORKSPACE}/../other`);
		expect(isWithinWorkspace(traversalPath, WORKSPACE)).toBe(false);
	});
});

describe("validatePath", () => {
	it("returns valid for paths within workspace when restricted", () => {
		const result = validatePath("src/file.ts", WORKSPACE, true);
		expect(result.valid).toBe(true);
		expect(result.resolved).toBe(`${WORKSPACE}/src/file.ts`);
		expect(result.error).toBeUndefined();
	});

	it("returns invalid for paths outside workspace when restricted", () => {
		const result = validatePath("/etc/passwd", WORKSPACE, true);
		expect(result.valid).toBe(false);
		expect(result.resolved).toBe("/etc/passwd");
		expect(result.error).toContain("outside the workspace");
	});

	it("blocks ../ traversal when restricted", () => {
		const result = validatePath("../../../etc/passwd", WORKSPACE, true);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("outside the workspace");
	});

	it("allows paths outside workspace when not restricted", () => {
		const result = validatePath("/etc/passwd", WORKSPACE, false);
		expect(result.valid).toBe(true);
		expect(result.resolved).toBe("/etc/passwd");
		expect(result.error).toBeUndefined();
	});

	it("allows ../ traversal when not restricted", () => {
		const result = validatePath("../other/file.txt", WORKSPACE, false);
		expect(result.valid).toBe(true);
		expect(result.resolved).toBe("/home/user/other/file.txt");
	});

	it("expands ~ and validates against workspace", () => {
		const home = homedir();
		const result = validatePath("~/file.txt", WORKSPACE, true);
		if (home.startsWith(WORKSPACE + sep) || home === WORKSPACE) {
			expect(result.valid).toBe(true);
		} else {
			expect(result.valid).toBe(false);
			expect(result.error).toContain("outside the workspace");
		}
	});
});
