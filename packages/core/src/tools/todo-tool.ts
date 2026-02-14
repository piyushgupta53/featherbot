import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Tool } from "./types.js";

export interface TodoItem {
	id: number;
	text: string;
	done: boolean;
	createdAt: string;
	completedAt?: string;
}

export interface TodoToolOptions {
	filePath: string;
}

export class TodoTool implements Tool {
	readonly name = "todo";
	readonly description =
		"Manage a structured todo list. Actions: add (create item), list (show all), complete (mark done), delete (remove item).";
	readonly parameters = z.object({
		action: z.enum(["add", "list", "complete", "delete"]).describe("The action to perform"),
		text: z.string().optional().describe("Text for the todo item (required for 'add')"),
		id: z
			.number()
			.int()
			.optional()
			.describe("ID of the todo item (required for 'complete' and 'delete')"),
	});

	private readonly filePath: string;

	constructor(options: TodoToolOptions) {
		this.filePath = options.filePath;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const action = params.action as string;
		const text = params.text as string | undefined;
		const id = params.id as number | undefined;

		switch (action) {
			case "add":
				return this.add(text);
			case "list":
				return this.list();
			case "complete":
				return this.complete(id);
			case "delete":
				return this.remove(id);
			default:
				return `Error: Unknown action '${action}'`;
		}
	}

	private add(text?: string): string {
		if (!text?.trim()) {
			return "Error: 'text' is required for the 'add' action.";
		}
		const todos = this.load();
		const maxId = todos.reduce((max, t) => Math.max(max, t.id), 0);
		const item: TodoItem = {
			id: maxId + 1,
			text: text.trim(),
			done: false,
			createdAt: new Date().toISOString(),
		};
		todos.push(item);
		this.save(todos);
		return `Added todo #${item.id}: ${item.text}`;
	}

	private list(): string {
		const todos = this.load();
		if (todos.length === 0) {
			return "No todos found. Use action 'add' to create one.";
		}
		const lines = todos.map((t) => {
			const status = t.done ? "[x]" : "[ ]";
			return `${status} #${t.id}: ${t.text}`;
		});
		const pending = todos.filter((t) => !t.done).length;
		const done = todos.filter((t) => t.done).length;
		lines.push("");
		lines.push(`${pending} pending, ${done} completed`);
		return lines.join("\n");
	}

	private complete(id?: number): string {
		if (id === undefined) {
			return "Error: 'id' is required for the 'complete' action.";
		}
		const todos = this.load();
		const item = todos.find((t) => t.id === id);
		if (!item) {
			return `Error: Todo #${id} not found.`;
		}
		if (item.done) {
			return `Todo #${id} is already completed.`;
		}
		item.done = true;
		item.completedAt = new Date().toISOString();
		this.save(todos);
		return `Completed todo #${id}: ${item.text}`;
	}

	private remove(id?: number): string {
		if (id === undefined) {
			return "Error: 'id' is required for the 'delete' action.";
		}
		const todos = this.load();
		const index = todos.findIndex((t) => t.id === id);
		if (index === -1) {
			return `Error: Todo #${id} not found.`;
		}
		const [removed] = todos.splice(index, 1);
		this.save(todos);
		return `Deleted todo #${id}: ${removed?.text ?? "(unknown)"}`;
	}

	private load(): TodoItem[] {
		try {
			if (!existsSync(this.filePath)) {
				return [];
			}
			const raw = readFileSync(this.filePath, "utf-8");
			return JSON.parse(raw) as TodoItem[];
		} catch (err) {
			console.warn(`[todo] failed to load ${this.filePath}:`, err);
			return [];
		}
	}

	private save(todos: TodoItem[]): void {
		const dir = dirname(this.filePath);
		mkdirSync(dir, { recursive: true });
		writeFileSync(this.filePath, JSON.stringify(todos, null, 2), "utf-8");
	}
}
