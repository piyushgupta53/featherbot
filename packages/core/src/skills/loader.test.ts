import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillsLoader, createSkillsLoader } from "./loader.js";

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "skills-test-"));
}

function writeSkill(dir: string, name: string, frontmatter: string, body: string): void {
	const skillDir = join(dir, name);
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}`);
}

describe("SkillsLoader", () => {
	describe("listSkills", () => {
		it("discovers skills from a single directory", () => {
			const dir = makeTempDir();
			writeSkill(dir, "weather", 'name: weather\ndescription: "Check weather"', "# Weather");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const skills = loader.listSkills();
			expect(skills).toHaveLength(1);
			expect(skills[0]?.name).toBe("weather");
			expect(skills[0]?.source).toBe("builtin");
		});

		it("discovers skills from multiple directories", () => {
			const builtinDir = makeTempDir();
			const userDir = makeTempDir();
			writeSkill(builtinDir, "weather", 'name: weather\ndescription: "Weather"', "# W");
			writeSkill(userDir, "github", 'name: github\ndescription: "GitHub"', "# G");
			const loader = new SkillsLoader({ builtinSkillsDir: builtinDir, userSkillsDir: userDir });
			const skills = loader.listSkills();
			expect(skills).toHaveLength(2);
			const names = skills.map((s) => s.name);
			expect(names).toContain("weather");
			expect(names).toContain("github");
		});

		it("workspace skills override builtin with same directory name", () => {
			const builtinDir = makeTempDir();
			const wsDir = makeTempDir();
			const wsSkillsDir = join(wsDir, "skills");
			mkdirSync(wsSkillsDir);
			writeSkill(builtinDir, "weather", 'name: weather\ndescription: "Built-in"', "# B");
			writeSkill(wsSkillsDir, "weather", 'name: weather\ndescription: "Workspace"', "# W");
			const loader = new SkillsLoader({
				workspacePath: wsDir,
				builtinSkillsDir: builtinDir,
			});
			const skills = loader.listSkills();
			expect(skills).toHaveLength(1);
			expect(skills[0]?.description).toBe("Workspace");
			expect(skills[0]?.source).toBe("workspace");
		});

		it("returns sorted skills by name", () => {
			const dir = makeTempDir();
			writeSkill(dir, "zebra", 'name: zebra\ndescription: "Z"', "# Z");
			writeSkill(dir, "alpha", 'name: alpha\ndescription: "A"', "# A");
			writeSkill(dir, "middle", 'name: middle\ndescription: "M"', "# M");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const skills = loader.listSkills();
			expect(skills.map((s) => s.name)).toEqual(["alpha", "middle", "zebra"]);
		});

		it("skips directories without SKILL.md", () => {
			const dir = makeTempDir();
			mkdirSync(join(dir, "empty-skill"));
			writeSkill(dir, "valid", 'name: valid\ndescription: "Valid"', "# V");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const skills = loader.listSkills();
			expect(skills).toHaveLength(1);
			expect(skills[0]?.name).toBe("valid");
		});

		it("handles missing directories gracefully", () => {
			const loader = new SkillsLoader({ builtinSkillsDir: "/nonexistent/path" });
			const skills = loader.listSkills();
			expect(skills).toEqual([]);
		});

		it("uses directory name when frontmatter name is missing", () => {
			const dir = makeTempDir();
			writeSkill(dir, "my-tool", 'description: "A tool"', "# Tool");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const skills = loader.listSkills();
			expect(skills[0]?.name).toBe("my-tool");
		});
	});

	describe("loadSkill", () => {
		it("returns body with frontmatter stripped", () => {
			const dir = makeTempDir();
			writeSkill(dir, "weather", 'name: weather\ndescription: "W"', "# Weather\n\nContent here.");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const body = loader.loadSkill("weather");
			expect(body).toBe("# Weather\n\nContent here.");
			expect(body).not.toContain("---");
		});

		it("returns undefined for nonexistent skill", () => {
			const dir = makeTempDir();
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			expect(loader.loadSkill("nonexistent")).toBeUndefined();
		});

		it("loads from the highest priority source", () => {
			const builtinDir = makeTempDir();
			const wsDir = makeTempDir();
			const wsSkillsDir = join(wsDir, "skills");
			mkdirSync(wsSkillsDir);
			writeSkill(builtinDir, "weather", 'name: weather\ndescription: "B"', "Builtin body");
			writeSkill(wsSkillsDir, "weather", 'name: weather\ndescription: "W"', "Workspace body");
			const loader = new SkillsLoader({ workspacePath: wsDir, builtinSkillsDir: builtinDir });
			expect(loader.loadSkill("weather")).toBe("Workspace body");
		});
	});

	describe("requirement checking", () => {
		it("marks skills with no requirements as available", () => {
			const dir = makeTempDir();
			writeSkill(dir, "simple", 'name: simple\ndescription: "Simple"', "# S");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const skills = loader.listSkills();
			expect(skills[0]?.available).toBe(true);
			expect(skills[0]?.missingRequirements).toEqual([]);
		});

		it("marks skills with missing env vars as unavailable", () => {
			const dir = makeTempDir();
			writeSkill(
				dir,
				"needs-env",
				'name: needs-env\ndescription: "Needs env"\nrequires:\n  env: [VERY_UNLIKELY_ENV_VAR_12345]',
				"# E",
			);
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const skills = loader.listSkills();
			expect(skills[0]?.available).toBe(false);
			expect(skills[0]?.missingRequirements).toContain("env:VERY_UNLIKELY_ENV_VAR_12345");
		});

		it("marks skills with missing binaries as unavailable", () => {
			const dir = makeTempDir();
			writeSkill(
				dir,
				"needs-bin",
				'name: needs-bin\ndescription: "Needs bin"\nrequires:\n  bins: [nonexistent_binary_xyz_99]',
				"# B",
			);
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const skills = loader.listSkills();
			expect(skills[0]?.available).toBe(false);
			expect(skills[0]?.missingRequirements).toContain("bin:nonexistent_binary_xyz_99");
		});
	});

	describe("buildSummary", () => {
		it("returns empty skills tag when no skills found", () => {
			const loader = new SkillsLoader({ builtinSkillsDir: "/nonexistent" });
			expect(loader.buildSummary()).toBe("<skills></skills>");
		});

		it("generates XML summary for available skills", () => {
			const dir = makeTempDir();
			writeSkill(dir, "weather", 'name: weather\ndescription: "Check weather"', "# W");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const summary = loader.buildSummary();
			expect(summary).toContain("<skills>");
			expect(summary).toContain('name="weather"');
			expect(summary).toContain('available="true"');
			expect(summary).toContain('source="builtin"');
			expect(summary).toContain("Check weather");
			expect(summary).toContain("</skills>");
		});

		it("includes requires tag for unavailable skills", () => {
			const dir = makeTempDir();
			writeSkill(
				dir,
				"github",
				'name: github\ndescription: "GitHub"\nrequires:\n  bins: [nonexistent_bin_xyz]\n  env: [MISSING_TOKEN_XYZ]',
				"# G",
			);
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const summary = loader.buildSummary();
			expect(summary).toContain('available="false"');
			expect(summary).toContain("<requires>");
			expect(summary).toContain("bin:nonexistent_bin_xyz");
			expect(summary).toContain("env:MISSING_TOKEN_XYZ");
		});

		it("excludes always-loaded skills from summary", () => {
			const dir = makeTempDir();
			writeSkill(dir, "always-on", 'name: always-on\ndescription: "Always"\nalways: true', "# A");
			writeSkill(dir, "normal", 'name: normal\ndescription: "Normal"', "# N");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const summary = loader.buildSummary();
			expect(summary).not.toContain("always-on");
			expect(summary).toContain("normal");
		});
	});

	describe("getAlwaysLoadedSkills", () => {
		it("returns only skills marked as always", () => {
			const dir = makeTempDir();
			writeSkill(
				dir,
				"always-skill",
				'name: always\ndescription: "A"\nalways: true',
				"Always body",
			);
			writeSkill(dir, "normal-skill", 'name: normal\ndescription: "N"', "Normal body");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			const always = loader.getAlwaysLoadedSkills();
			expect(always).toHaveLength(1);
			expect(always[0]?.name).toBe("always");
			expect(always[0]?.body).toBe("Always body");
		});

		it("returns empty array when no always skills", () => {
			const dir = makeTempDir();
			writeSkill(dir, "normal", 'name: normal\ndescription: "N"', "# N");
			const loader = new SkillsLoader({ builtinSkillsDir: dir });
			expect(loader.getAlwaysLoadedSkills()).toEqual([]);
		});
	});

	describe("createSkillsLoader factory", () => {
		it("creates a SkillsLoader instance", () => {
			const loader = createSkillsLoader({ builtinSkillsDir: "/tmp" });
			expect(loader).toBeInstanceOf(SkillsLoader);
		});
	});
});
