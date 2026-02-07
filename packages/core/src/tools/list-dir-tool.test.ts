import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListDirTool } from "./list-dir-tool.js";

describe("ListDirTool", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await realpath(await mkdtemp(join(tmpdir(), "list-dir-test-")));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	function createTool(restrictToWorkspace = false): ListDirTool {
		return new ListDirTool({ workspaceDir: tempDir, restrictToWorkspace });
	}

	it("has correct name", () => {
		expect(createTool().name).toBe("list_dir");
	});

	it("lists directory contents with indicators", async () => {
		await writeFile(join(tempDir, "file.txt"), "content");
		await mkdir(join(tempDir, "subdir"));

		const result = await createTool().execute({ path: tempDir });
		expect(result).toContain("[file]  file.txt");
		expect(result).toContain("[dir]  subdir");
	});

	it("returns sorted output", async () => {
		await writeFile(join(tempDir, "charlie.txt"), "");
		await writeFile(join(tempDir, "alpha.txt"), "");
		await writeFile(join(tempDir, "bravo.txt"), "");

		const result = await createTool().execute({ path: tempDir });
		const lines = result.split("\n");
		expect(lines[0]).toContain("alpha.txt");
		expect(lines[1]).toContain("bravo.txt");
		expect(lines[2]).toContain("charlie.txt");
	});

	it("returns error for path not found", async () => {
		const result = await createTool().execute({ path: join(tempDir, "nonexistent") });
		expect(result).toContain("Error: Directory not found");
	});

	it("returns error when path is a file, not a directory", async () => {
		await writeFile(join(tempDir, "file.txt"), "content");
		const result = await createTool().execute({ path: join(tempDir, "file.txt") });
		expect(result).toContain("is not a directory");
	});

	it("blocks path outside workspace when restricted", async () => {
		const tool = createTool(true);
		const result = await tool.execute({ path: "/etc" });
		expect(result).toContain("outside the workspace");
	});

	it("returns empty string for empty directory", async () => {
		const result = await createTool().execute({ path: tempDir });
		expect(result).toBe("");
	});
});
