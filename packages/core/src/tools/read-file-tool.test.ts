import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadFileTool } from "./read-file-tool.js";

describe("ReadFileTool", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await realpath(await mkdtemp(join(tmpdir(), "read-file-test-")));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	function createTool(restrictToWorkspace = false): ReadFileTool {
		return new ReadFileTool({ workspaceDir: tempDir, restrictToWorkspace });
	}

	it("has correct name", () => {
		expect(createTool().name).toBe("read_file");
	});

	it("reads an existing file", async () => {
		await writeFile(join(tempDir, "hello.txt"), "hello world");
		const result = await createTool().execute({ path: join(tempDir, "hello.txt") });
		expect(result).toBe("hello world");
	});

	it("returns error for file not found", async () => {
		const result = await createTool().execute({ path: join(tempDir, "missing.txt") });
		expect(result).toContain("Error: File not found");
	});

	it("returns error when path is a directory", async () => {
		await mkdir(join(tempDir, "subdir"));
		const result = await createTool().execute({ path: join(tempDir, "subdir") });
		expect(result).toContain("is a directory");
	});

	it("blocks path outside workspace when restricted", async () => {
		const tool = createTool(true);
		const result = await tool.execute({ path: "/etc/hosts" });
		expect(result).toContain("outside the workspace");
	});

	it("allows path outside workspace when not restricted", async () => {
		const tool = createTool(false);
		const result = await tool.execute({ path: "/etc/hosts" });
		expect(result).not.toContain("outside the workspace");
	});
});
