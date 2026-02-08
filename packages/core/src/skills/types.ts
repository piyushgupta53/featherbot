import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const SkillRequirementsSchema = z.object({
	bins: z.array(z.string()).default([]),
	env: z.array(z.string()).default([]),
});

export const SkillMetadataSchema = z.object({
	name: z.string().default("unknown"),
	description: z.string().default(""),
	requires: SkillRequirementsSchema.default({}),
	always: z.boolean().default(false),
});

export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;
export type SkillRequirements = z.infer<typeof SkillRequirementsSchema>;

export type SkillSource = "workspace" | "user" | "builtin";

export interface Skill {
	readonly name: string;
	readonly description: string;
	readonly source: SkillSource;
	readonly path: string;
	readonly metadata: SkillMetadata;
	readonly available: boolean;
	readonly missingRequirements: string[];
}

export interface ParsedFrontmatter {
	metadata: SkillMetadata;
	body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
	const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
	const match = content.match(fmRegex);

	if (!match) {
		return {
			metadata: SkillMetadataSchema.parse({}),
			body: content.trim(),
		};
	}

	const yamlStr = match[1] ?? "";
	const body = (match[2] ?? "").trim();

	if (!yamlStr.trim()) {
		return {
			metadata: SkillMetadataSchema.parse({}),
			body,
		};
	}

	let raw: unknown;
	try {
		raw = parseYaml(yamlStr);
	} catch {
		return {
			metadata: SkillMetadataSchema.parse({}),
			body,
		};
	}

	if (raw === null || typeof raw !== "object") {
		return {
			metadata: SkillMetadataSchema.parse({}),
			body,
		};
	}

	const metadata = SkillMetadataSchema.parse(raw);
	return { metadata, body };
}
