import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import type { MemoryStore } from "../memory/types.js";
import type { SkillsLoader } from "../skills/loader.js";

export interface SessionContext {
	channelName?: string;
	chatId?: string;
}

export interface ContextBuilderOptions {
	workspacePath: string;
	bootstrapFiles: string[];
	agentName: string;
	memoryStore?: MemoryStore;
	skillsLoader?: SkillsLoader;
}

export interface ContextBuilderResult {
	systemPrompt: string;
}

export class ContextBuilder {
	readonly workspacePath: string;
	readonly bootstrapFiles: string[];
	readonly agentName: string;
	readonly memoryStore?: MemoryStore;
	readonly skillsLoader?: SkillsLoader;

	constructor(options: ContextBuilderOptions) {
		this.workspacePath = options.workspacePath;
		this.bootstrapFiles = options.bootstrapFiles;
		this.agentName = options.agentName;
		this.memoryStore = options.memoryStore;
		this.skillsLoader = options.skillsLoader;
	}

	async build(sessionContext?: SessionContext): Promise<ContextBuilderResult> {
		const sections: string[] = [];
		sections.push(this.buildIdentityBlock());

		const { sections: bootstrapSections, contentMap } = await this.loadBootstrapFiles();
		for (const section of bootstrapSections) {
			sections.push(section);
		}

		if (this.isFirstConversation(contentMap)) {
			sections.push(this.buildFirstConversationSection());
		}

		const memorySection = await this.buildMemorySection();
		if (memorySection) {
			sections.push(memorySection);
			sections.push(this.buildMemoryManagementSection());
		}

		const skillsSection = this.buildSkillsSection();
		if (skillsSection) {
			sections.push(skillsSection);
		}

		const sessionSection = this.buildSessionSection(sessionContext);
		if (sessionSection) {
			sections.push(sessionSection);
		}

		return { systemPrompt: sections.join("\n\n") };
	}

	private buildIdentityBlock(): string {
		const lines = [
			"## Identity",
			`Name: ${this.agentName}`,
			`Timestamp: ${new Date().toISOString()}`,
			`Node.js: ${process.version}`,
			`Platform: ${platform()}`,
			`Workspace: ${this.workspacePath}`,
		];
		return lines.join("\n");
	}

	private async buildMemorySection(): Promise<string | null> {
		if (this.memoryStore === undefined) {
			return null;
		}
		const context = await this.memoryStore.getMemoryContext();
		const trimmed = context.trim();
		if (!trimmed) {
			return null;
		}
		return `## Memory\n${trimmed}`;
	}

	private buildMemoryManagementSection(): string {
		const lines = [
			"## Memory Management",
			"You have a memory file at memory/MEMORY.md with sections: Facts, Observed Patterns, and Pending.",
			"As you converse, selectively update it using edit_file. Only log what matters:",
			"",
			"**Facts** — User preferences, personal details, projects, or things they explicitly ask you to remember.",
			"**Observed Patterns** — Recurring behaviors you notice over multiple conversations (e.g., always asks for concise answers, works late at night, prefers Python over JS).",
			"**Pending** — Follow-ups, reminders, or things the user mentioned wanting to do later.",
			"",
			"Guidelines:",
			"- Do NOT log every message or trivial details — only meaningful, reusable information.",
			'- If the user says "remember this" or similar, always persist it.',
			"- Update existing entries rather than duplicating them.",
			"- Remove Pending items once they are resolved.",
			"- For daily context (today's tasks, current mood, etc.), use a daily note at memory/YYYY-MM-DD.md instead.",
		];
		return lines.join("\n");
	}

	private buildSkillsSection(): string | null {
		if (this.skillsLoader === undefined) {
			return null;
		}

		const lines: string[] = ["## Skills"];

		const alwaysLoaded = this.skillsLoader.getAlwaysLoadedSkills();
		if (alwaysLoaded.length > 0) {
			lines.push("");
			lines.push("### Active Skills");
			for (const skill of alwaysLoaded) {
				lines.push("");
				lines.push(`#### ${skill.name}`);
				lines.push(skill.body);
			}
		}

		const summary = this.skillsLoader.buildSummary();
		lines.push("");
		lines.push("### Available Skills");
		lines.push("");
		lines.push(
			"To use an available skill, read its SKILL.md file using the read_file tool to get full instructions.",
		);
		lines.push("");
		lines.push(summary);

		return lines.join("\n");
	}

	private buildSessionSection(sessionContext?: SessionContext): string | null {
		if (sessionContext === undefined) {
			return null;
		}
		const lines: string[] = [];
		if (sessionContext.channelName) {
			lines.push(`Channel: ${sessionContext.channelName}`);
		}
		if (sessionContext.chatId) {
			lines.push(`Chat ID: ${sessionContext.chatId}`);
		}
		if (lines.length === 0) {
			return null;
		}
		return `## Session\n${lines.join("\n")}`;
	}

	private isFirstConversation(bootstrapContent: Map<string, string>): boolean {
		const userContent = bootstrapContent.get("USER.md");
		if (!userContent) {
			return false;
		}
		return userContent.includes("(your name here)");
	}

	private buildFirstConversationSection(): string {
		const lines = [
			"## First Conversation",
			"This is the user's first conversation — USER.md still has placeholder values.",
			"",
			"Your goals for this conversation:",
			"1. Warmly introduce yourself by name and explain briefly what you can do.",
			"2. Naturally ask the user's name, where they're from, and their timezone.",
			"3. Ask what they're interested in or how they plan to use you.",
			"4. Keep it conversational — ask only 1-2 questions at a time, don't interrogate.",
			"5. Once you've gathered their info, use the edit_file tool to update USER.md:",
			"   - Replace `(your name here)` with their actual name",
			"   - Replace `(your timezone, e.g., Asia/Kolkata)` with their timezone",
			"   - Replace `(add your interests)` with their interests",
			"   - Fill in the Notes section with any other facts they share",
			"6. Also use edit_file to update memory/MEMORY.md — add a ## Facts section with key user facts.",
			"7. After updating the files, transition naturally into being helpful with whatever they need.",
		];
		return lines.join("\n");
	}

	private async loadBootstrapFiles(): Promise<{
		sections: string[];
		contentMap: Map<string, string>;
	}> {
		const sections: string[] = [];
		const contentMap = new Map<string, string>();
		for (const filename of this.bootstrapFiles) {
			const filePath = join(this.workspacePath, filename);
			const content = (await this.readFileSafe(filePath)).trim();
			if (content) {
				sections.push(`## ${filename}\n${content}`);
				contentMap.set(filename, content);
			}
		}
		return { sections, contentMap };
	}

	private async readFileSafe(filePath: string): Promise<string> {
		try {
			return await readFile(filePath, "utf-8");
		} catch (err: unknown) {
			if (err !== null && typeof err === "object" && "code" in err && err.code === "ENOENT") {
				return "";
			}
			throw err;
		}
	}
}
