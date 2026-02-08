import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkRequirements } from "./requirements.js";
import { parseFrontmatter } from "./types.js";
import type { Skill, SkillSource } from "./types.js";

export interface SkillsLoaderOptions {
	workspacePath?: string;
	userSkillsDir?: string;
	builtinSkillsDir?: string;
}

export class SkillsLoader {
	private readonly searchPaths: Array<{ dir: string; source: SkillSource }>;

	constructor(options: SkillsLoaderOptions) {
		this.searchPaths = [];
		if (options.workspacePath) {
			this.searchPaths.push({
				dir: join(options.workspacePath, "skills"),
				source: "workspace",
			});
		}
		if (options.userSkillsDir) {
			this.searchPaths.push({
				dir: options.userSkillsDir,
				source: "user",
			});
		}
		if (options.builtinSkillsDir) {
			this.searchPaths.push({
				dir: options.builtinSkillsDir,
				source: "builtin",
			});
		}
	}

	listSkills(): Skill[] {
		const seen = new Set<string>();
		const skills: Skill[] = [];

		for (const { dir, source } of this.searchPaths) {
			const entries = this.readDirSafe(dir);
			for (const entry of entries) {
				if (seen.has(entry)) {
					continue;
				}
				const skillPath = join(dir, entry, "SKILL.md");
				if (!this.isFile(skillPath)) {
					continue;
				}
				const content = this.readFileSafe(skillPath);
				if (content === undefined) {
					continue;
				}
				const parsed = parseFrontmatter(content);
				const name = parsed.metadata.name !== "unknown" ? parsed.metadata.name : entry;
				const reqResult = checkRequirements(parsed.metadata);
				seen.add(entry);
				skills.push({
					name,
					description: parsed.metadata.description,
					source,
					path: skillPath,
					metadata: parsed.metadata,
					available: reqResult.available,
					missingRequirements: reqResult.missing,
				});
			}
		}

		skills.sort((a, b) => a.name.localeCompare(b.name));
		return skills;
	}

	buildSummary(): string {
		const skills = this.listSkills();
		if (skills.length === 0) {
			return "<skills></skills>";
		}
		const lines = ["<skills>"];
		for (const skill of skills) {
			if (skill.metadata.always) {
				continue;
			}
			const attrs = [
				`name="${skill.name}"`,
				`available="${skill.available}"`,
				`source="${skill.source}"`,
				`path="${skill.path}"`,
			];
			lines.push(`  <skill ${attrs.join(" ")}>`);
			lines.push(`    ${skill.description}`);
			if (skill.missingRequirements.length > 0) {
				lines.push(`    <requires>${skill.missingRequirements.join(", ")}</requires>`);
			}
			lines.push("  </skill>");
		}
		lines.push("</skills>");
		return lines.join("\n");
	}

	getAlwaysLoadedSkills(): Array<{ name: string; body: string }> {
		const skills = this.listSkills();
		const result: Array<{ name: string; body: string }> = [];
		for (const skill of skills) {
			if (!skill.metadata.always) {
				continue;
			}
			const content = this.readFileSafe(skill.path);
			if (content !== undefined) {
				const parsed = parseFrontmatter(content);
				if (parsed.body) {
					result.push({ name: skill.name, body: parsed.body });
				}
			}
		}
		return result;
	}

	loadSkill(name: string): string | undefined {
		for (const { dir } of this.searchPaths) {
			const skillPath = join(dir, name, "SKILL.md");
			const content = this.readFileSafe(skillPath);
			if (content !== undefined) {
				const parsed = parseFrontmatter(content);
				return parsed.body;
			}
		}
		return undefined;
	}

	private readDirSafe(dir: string): string[] {
		try {
			return readdirSync(dir);
		} catch {
			return [];
		}
	}

	private readFileSafe(filePath: string): string | undefined {
		try {
			return readFileSync(filePath, "utf-8");
		} catch {
			return undefined;
		}
	}

	private isFile(filePath: string): boolean {
		try {
			return statSync(filePath).isFile();
		} catch {
			return false;
		}
	}
}

export function createSkillsLoader(options: SkillsLoaderOptions): SkillsLoader {
	return new SkillsLoader(options);
}
