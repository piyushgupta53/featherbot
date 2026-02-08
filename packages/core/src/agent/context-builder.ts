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

		const bootstrapSections = await this.loadBootstrapFiles();
		for (const section of bootstrapSections) {
			sections.push(section);
		}

		const memorySection = await this.buildMemorySection();
		if (memorySection) {
			sections.push(memorySection);
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

	private async loadBootstrapFiles(): Promise<string[]> {
		const sections: string[] = [];
		for (const filename of this.bootstrapFiles) {
			const filePath = join(this.workspacePath, filename);
			const content = (await this.readFileSafe(filePath)).trim();
			if (content) {
				sections.push(`## ${filename}\n${content}`);
			}
		}
		return sections;
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
