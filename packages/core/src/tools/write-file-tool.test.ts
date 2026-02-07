import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WriteFileTool } from "./write-file-tool.js";

describe("WriteFileTool", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await realpath(await mkdtemp(join(tmpdir(), "write-file-test-")));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	function createTool(restrictToWorkspace = false): WriteFileTool {
		return new WriteFileTool({ workspaceDir: tempDir, restrictToWorkspace });
	}

	it("has correct name", () => {
		expect(createTool().name).toBe("write_file");
	});

	it("writes a new file", async () => {
		const filePath = join(tempDir, "new.txt");
		const result = await createTool().execute({ path: filePath, content: "hello" });
		expect(result).toContain("Successfully wrote");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("hello");
	});

	it("overwrites an existing file", async () => {
		const filePath = join(tempDir, "existing.txt");
		await writeFile(filePath, "old content");
		await createTool().execute({ path: filePath, content: "new content" });
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("new content");
	});

	it("auto-creates parent directories", async () => {
		const filePath = join(tempDir, "deep", "nested", "dir", "file.txt");
		const result = await createTool().execute({ path: filePath, content: "deep" });
		expect(result).toContain("Successfully wrote");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("deep");
	});

	it("blocks path outside workspace when restricted", async () => {
		const tool = createTool(true);
		const result = await tool.execute({ path: "/tmp/outside.txt", content: "nope" });
		expect(result).toContain("outside the workspace");
	});
});
