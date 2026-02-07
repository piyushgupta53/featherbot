import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditFileTool } from "./edit-file-tool.js";

describe("EditFileTool", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await realpath(await mkdtemp(join(tmpdir(), "edit-file-test-")));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	function createTool(restrictToWorkspace = false): EditFileTool {
		return new EditFileTool({ workspaceDir: tempDir, restrictToWorkspace });
	}

	it("has correct name", () => {
		expect(createTool().name).toBe("edit_file");
	});

	it("replaces oldText with newText", async () => {
		const filePath = join(tempDir, "file.txt");
		await writeFile(filePath, "hello world");
		const result = await createTool().execute({
			path: filePath,
			oldText: "world",
			newText: "earth",
		});
		expect(result).toContain("Successfully edited");
		const content = await readFile(filePath, "utf-8");
		expect(content).toBe("hello earth");
	});

	it("returns error when oldText not found", async () => {
		const filePath = join(tempDir, "file.txt");
		await writeFile(filePath, "hello world");
		const result = await createTool().execute({
			path: filePath,
			oldText: "missing",
			newText: "replacement",
		});
		expect(result).toContain("oldText not found");
	});

	it("returns error for ambiguous match (>1 occurrence)", async () => {
		const filePath = join(tempDir, "file.txt");
		await writeFile(filePath, "foo bar foo baz foo");
		const result = await createTool().execute({
			path: filePath,
			oldText: "foo",
			newText: "qux",
		});
		expect(result).toContain("appears 3 times");
		expect(result).toContain("ambiguous");
	});

	it("returns error for file not found", async () => {
		const result = await createTool().execute({
			path: join(tempDir, "missing.txt"),
			oldText: "a",
			newText: "b",
		});
		expect(result).toContain("File not found");
	});

	it("blocks path outside workspace when restricted", async () => {
		const tool = createTool(true);
		const result = await tool.execute({
			path: "/etc/hosts",
			oldText: "a",
			newText: "b",
		});
		expect(result).toContain("outside the workspace");
	});
});
