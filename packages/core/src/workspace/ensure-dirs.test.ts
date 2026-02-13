import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureWorkspaceDirsSync, resolveWorkspaceDirs } from "./ensure-dirs.js";

describe("resolveWorkspaceDirs", () => {
	it("resolves all directories relative to workspace", () => {
		const dirs = resolveWorkspaceDirs("/home/user/workspace", "data", "scratch");
		expect(dirs.workspace).toBe("/home/user/workspace");
		expect(dirs.data).toBe("/home/user/workspace/data");
		expect(dirs.scratch).toBe("/home/user/workspace/scratch");
		expect(dirs.memory).toBe("/home/user/workspace/memory");
	});

	it("supports custom directory names", () => {
		const dirs = resolveWorkspaceDirs("/ws", "output", "tmp");
		expect(dirs.data).toBe("/ws/output");
		expect(dirs.scratch).toBe("/ws/tmp");
	});
});

describe("ensureWorkspaceDirsSync", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "ensure-dirs-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	it("creates data, scratch, and memory directories", () => {
		const dirs = resolveWorkspaceDirs(tempDir, "data", "scratch");
		ensureWorkspaceDirsSync(dirs);

		expect(existsSync(dirs.data)).toBe(true);
		expect(existsSync(dirs.scratch)).toBe(true);
		expect(existsSync(dirs.memory)).toBe(true);
	});

	it("is idempotent — does not fail if directories already exist", () => {
		const dirs = resolveWorkspaceDirs(tempDir, "data", "scratch");
		ensureWorkspaceDirsSync(dirs);
		ensureWorkspaceDirsSync(dirs);

		expect(existsSync(dirs.data)).toBe(true);
	});
});
