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
	isFirstConversation: boolean;
	userTimezone?: string;
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

		const { sections: bootstrapSections, contentMap } = await this.loadBootstrapFiles();
		const userTimezone = extractTimezone(contentMap);
		sections.push(this.buildIdentityBlock(userTimezone ?? undefined));

		for (const section of bootstrapSections) {
			sections.push(section);
		}

		const firstConversation = this.isFirstConversation(contentMap);
		if (firstConversation) {
			sections.push(this.buildFirstConversationSection(sessionContext));
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

		return {
			systemPrompt: sections.join("\n\n"),
			isFirstConversation: firstConversation,
			userTimezone: userTimezone ?? undefined,
		};
	}

	private buildIdentityBlock(timezone?: string): string {
		const now = new Date();
		const lines = ["## Identity", `Name: ${this.agentName}`];
		if (timezone) {
			lines.push(`Timestamp (UTC): ${now.toISOString()}`);
			const localStr = now.toLocaleString("en-US", {
				timeZone: timezone,
				weekday: "short",
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				second: "2-digit",
				timeZoneName: "short",
			});
			lines.push(`Timestamp (local): ${localStr}`);
			lines.push(`Timezone: ${timezone}`);
		} else {
			lines.push(`Timestamp: ${now.toISOString()}`);
		}
		lines.push(`Node.js: ${process.version}`);
		lines.push(`Platform: ${platform()}`);
		lines.push(`Workspace: ${this.workspacePath}`);
		lines.push("");
		lines.push("Workspace layout:");
		lines.push("- data/ — persistent outputs (scripts, exports, saved files)");
		lines.push("- scratch/ — temp work area, auto-cleaned. Default cwd for exec.");
		lines.push("- memory/ — memory files (managed automatically)");
		lines.push("- Do not create files in workspace root.");
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
			"When you learn something worth remembering, you MUST call edit_file on memory/MEMORY.md to persist it. Never claim you stored something in memory without a successful edit_file result.",
			"Only log what matters:",
			"",
			"**Facts** — User preferences, personal details, projects, or things they explicitly ask you to remember.",
			"**Observed Patterns** — Recurring behaviors you notice over multiple conversations (e.g., always asks for concise answers, works late at night, prefers Python over JS).",
			"**Pending** — Follow-ups, reminders, or things the user mentioned wanting to do later.",
			"",
			"Guidelines:",
			"- Do NOT log every message or trivial details — only meaningful, reusable information.",
			'- If the user says "remember this" or similar, always persist it.',
			"- When the user shares personal info (name, location, workplace, preferences), call edit_file IMMEDIATELY in the same turn — do not just acknowledge it.",
			'- NEVER say "stored in memory" or "noted" unless edit_file returned a success result.',
			"- Update existing entries rather than duplicating them.",
			"- Remove Pending items once they are resolved.",
			"- For daily context (today's tasks, current mood, etc.), use a daily note at memory/YYYY-MM-DD.md instead.",
			"",
			"### Daily Note Format",
			"Daily notes (memory/YYYY-MM-DD.md) contain priority-tagged observations auto-extracted from conversations:",
			"- 🔴 Important — decisions, action items, strong preferences",
			"- 🟡 Moderate — topics discussed, tasks, notable context",
			"- 🟢 Minor — informational details, passing mentions",
			"Observations are grouped under session headers (e.g., `## telegram:123`). When reading daily notes, prioritize 🔴 items.",
			"",
			"### Heartbeat File",
			"You have a heartbeat file at HEARTBEAT.md that is reviewed automatically every few minutes.",
			"Use it for recurring awareness tasks, periodic checks, and standing instructions — things the agent should keep an eye on over time.",
			'Write to it via edit_file when the user mentions something that needs periodic attention (e.g., "keep an eye on my domain renewal", "remind me to drink water", "check if my server is up").',
			'Use the cron tool for precise time-based triggers (e.g., "at 9am every day"); use HEARTBEAT.md for softer periodic awareness that doesn\'t need exact timing.',
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

	private buildFirstConversationSection(sessionContext?: SessionContext): string {
		const channel = sessionContext?.channelName ?? "terminal";
		const lines = [
			"## First Conversation",
			"This is the user's first conversation — USER.md still has placeholder values.",
			`The user is chatting from the "${channel}" channel.`,
			"",
			"Your goals for this conversation:",
			"1. Warmly introduce yourself by name and explain briefly what you can do.",
			"2. Naturally ask the user's name, where they're from, and their timezone.",
			"3. Ask what they're interested in or how they plan to use you.",
			"4. Keep it conversational — ask only 1-2 questions at a time, don't interrogate.",
			"5. As soon as you learn the user's name, IMMEDIATELY update USER.md with a SINGLE edit_file call",
			"   that replaces the entire About block at once. This is critical — if you skip the name, the bot",
			"   will re-ask on every restart. Example:",
			"   ```",
			"   edit_file({",
			'     path: "USER.md",',
			'     oldText: "- Name: (your name here)\\n- Timezone: (your timezone, e.g., Asia/Kolkata)\\n- Language: English",',
			`     newText: "- Name: Alice\\n- Timezone: Asia/Kolkata\\n- Language: English"`,
			"   })",
			"   ```",
			`6. Also update the Preferences section: set preferred channels to "${channel}" and replace interests.`,
			"7. Use edit_file to update memory/MEMORY.md — add key user facts under ## Facts.",
			"8. After updating the files, transition naturally into being helpful with whatever they need.",
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

/**
 * Parse timezone from USER.md content. Returns IANA timezone string or null
 * if not found, placeholder, or invalid.
 */
export function parseTimezoneFromUserMd(content: string): string | null {
	const match = content.match(/^- Timezone:\s*(.+)$/m);
	if (!match?.[1]) {
		return null;
	}
	const raw = match[1].trim();
	if (!raw || raw.includes("(") || raw.includes("your timezone")) {
		return null;
	}
	try {
		Intl.DateTimeFormat(undefined, { timeZone: raw });
		return raw;
	} catch {
		return null;
	}
}

function extractTimezone(contentMap: Map<string, string>): string | null {
	const userContent = contentMap.get("USER.md");
	if (!userContent) {
		return null;
	}
	return parseTimezoneFromUserMd(userContent);
}
