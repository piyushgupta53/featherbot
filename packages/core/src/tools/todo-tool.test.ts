import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { TodoTool } from "./todo-tool.js";

const testDir = join(tmpdir(), "featherbot-todo-test");
const filePath = join(testDir, "todos.json");

let tool: TodoTool;

beforeEach(() => {
	rmSync(testDir, { recursive: true, force: true });
	tool = new TodoTool({ filePath });
});

describe("TodoTool", () => {
	it("adds a todo item", async () => {
		const result = await tool.execute({ action: "add", text: "Buy groceries" });
		expect(result).toContain("Added todo #1");
		expect(result).toContain("Buy groceries");
	});

	it("lists todos", async () => {
		await tool.execute({ action: "add", text: "Task 1" });
		await tool.execute({ action: "add", text: "Task 2" });

		const result = await tool.execute({ action: "list" });
		expect(result).toContain("[ ] #1: Task 1");
		expect(result).toContain("[ ] #2: Task 2");
		expect(result).toContain("2 pending, 0 completed");
	});

	it("returns message when list is empty", async () => {
		const result = await tool.execute({ action: "list" });
		expect(result).toContain("No todos found");
	});

	it("completes a todo", async () => {
		await tool.execute({ action: "add", text: "Do laundry" });
		const result = await tool.execute({ action: "complete", id: 1 });
		expect(result).toContain("Completed todo #1");

		const list = await tool.execute({ action: "list" });
		expect(list).toContain("[x] #1: Do laundry");
		expect(list).toContain("0 pending, 1 completed");
	});

	it("handles completing already-completed todo", async () => {
		await tool.execute({ action: "add", text: "Test" });
		await tool.execute({ action: "complete", id: 1 });
		const result = await tool.execute({ action: "complete", id: 1 });
		expect(result).toContain("already completed");
	});

	it("deletes a todo", async () => {
		await tool.execute({ action: "add", text: "Remove me" });
		const result = await tool.execute({ action: "delete", id: 1 });
		expect(result).toContain("Deleted todo #1");

		const list = await tool.execute({ action: "list" });
		expect(list).toContain("No todos found");
	});

	it("returns error for missing text on add", async () => {
		const result = await tool.execute({ action: "add" });
		expect(result).toContain("Error");
		expect(result).toContain("text");
	});

	it("returns error for missing id on complete", async () => {
		const result = await tool.execute({ action: "complete" });
		expect(result).toContain("Error");
		expect(result).toContain("id");
	});

	it("returns error for non-existent todo", async () => {
		const result = await tool.execute({ action: "complete", id: 999 });
		expect(result).toContain("Error");
		expect(result).toContain("not found");
	});

	it("assigns incrementing IDs", async () => {
		await tool.execute({ action: "add", text: "First" });
		await tool.execute({ action: "add", text: "Second" });
		await tool.execute({ action: "delete", id: 1 });
		await tool.execute({ action: "add", text: "Third" });

		const list = await tool.execute({ action: "list" });
		expect(list).toContain("#2: Second");
		expect(list).toContain("#3: Third");
	});
});
