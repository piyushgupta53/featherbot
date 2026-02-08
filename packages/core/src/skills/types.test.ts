import { describe, expect, it } from "vitest";
import { SkillMetadataSchema, parseFrontmatter } from "./types.js";

describe("SkillMetadataSchema", () => {
	it("parses valid full metadata", () => {
		const result = SkillMetadataSchema.parse({
			name: "weather",
			description: "Check weather",
			requires: { bins: ["curl"], env: ["API_KEY"] },
			always: true,
		});
		expect(result.name).toBe("weather");
		expect(result.description).toBe("Check weather");
		expect(result.requires.bins).toEqual(["curl"]);
		expect(result.requires.env).toEqual(["API_KEY"]);
		expect(result.always).toBe(true);
	});

	it("applies defaults for missing fields", () => {
		const result = SkillMetadataSchema.parse({});
		expect(result.name).toBe("unknown");
		expect(result.description).toBe("");
		expect(result.requires.bins).toEqual([]);
		expect(result.requires.env).toEqual([]);
		expect(result.always).toBe(false);
	});

	it("applies defaults for partial requires", () => {
		const result = SkillMetadataSchema.parse({
			name: "test",
			requires: { bins: ["gh"] },
		});
		expect(result.requires.bins).toEqual(["gh"]);
		expect(result.requires.env).toEqual([]);
	});
});

describe("parseFrontmatter", () => {
	it("parses valid frontmatter and body", () => {
		const content = [
			"---",
			"name: weather",
			'description: "Check weather"',
			"always: false",
			"---",
			"",
			"# Weather Skill",
			"",
			"Instructions here.",
		].join("\n");
		const result = parseFrontmatter(content);
		expect(result.metadata.name).toBe("weather");
		expect(result.metadata.description).toBe("Check weather");
		expect(result.metadata.always).toBe(false);
		expect(result.body).toBe("# Weather Skill\n\nInstructions here.");
	});

	it("returns defaults when no frontmatter present", () => {
		const content = "# Just Markdown\n\nSome content.";
		const result = parseFrontmatter(content);
		expect(result.metadata.name).toBe("unknown");
		expect(result.metadata.description).toBe("");
		expect(result.body).toBe("# Just Markdown\n\nSome content.");
	});

	it("handles empty frontmatter", () => {
		const content = "---\n\n---\n\n# Body";
		const result = parseFrontmatter(content);
		expect(result.metadata.name).toBe("unknown");
		expect(result.body).toBe("# Body");
	});

	it("handles malformed YAML gracefully", () => {
		const content = "---\n: invalid: yaml: [[\n---\n\n# Body";
		const result = parseFrontmatter(content);
		expect(result.metadata.name).toBe("unknown");
		expect(result.body).toBe("# Body");
	});

	it("handles empty content", () => {
		const result = parseFrontmatter("");
		expect(result.metadata.name).toBe("unknown");
		expect(result.body).toBe("");
	});

	it("parses requires with bins and env", () => {
		const content = [
			"---",
			"name: github",
			"requires:",
			"  bins: [gh]",
			"  env: [GITHUB_TOKEN]",
			"---",
			"# GitHub",
		].join("\n");
		const result = parseFrontmatter(content);
		expect(result.metadata.requires.bins).toEqual(["gh"]);
		expect(result.metadata.requires.env).toEqual(["GITHUB_TOKEN"]);
	});

	it("strips frontmatter from body", () => {
		const content = "---\nname: test\n---\nBody only";
		const result = parseFrontmatter(content);
		expect(result.body).toBe("Body only");
		expect(result.body).not.toContain("---");
	});
});
