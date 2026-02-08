import { execFileSync } from "node:child_process";
import type { SkillMetadata } from "./types.js";

export interface RequirementResult {
	available: boolean;
	missing: string[];
}

export function checkBinaryExists(name: string): boolean {
	try {
		execFileSync("command", ["-v", name], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function checkRequirements(metadata: SkillMetadata): RequirementResult {
	const missing: string[] = [];
	for (const bin of metadata.requires.bins) {
		if (!checkBinaryExists(bin)) {
			missing.push(`bin:${bin}`);
		}
	}
	for (const env of metadata.requires.env) {
		if (!process.env[env]) {
			missing.push(`env:${env}`);
		}
	}
	return { available: missing.length === 0, missing };
}
