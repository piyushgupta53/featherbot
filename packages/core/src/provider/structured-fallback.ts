import type { ZodType } from "zod";
import type {
	GenerateStructuredOptions,
	GenerateStructuredResult,
	LLMMessage,
	LLMProvider,
} from "./types.js";

/**
 * Extract a JSON value from free-form text that may contain preamble,
 * markdown fences, or trailing commentary.
 */
export function extractJsonFromText(text: string): unknown {
	const trimmed = text.trim();

	// 1. Direct parse
	try {
		return JSON.parse(trimmed);
	} catch {
		// continue
	}

	// 2. Markdown ```json ... ``` fences
	const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (fenceMatch) {
		try {
			return JSON.parse(fenceMatch[1]?.trim() ?? "");
		} catch {
			// continue
		}
	}

	// 3. Find outermost { ... } via brace-depth counter
	const start = trimmed.indexOf("{");
	if (start !== -1) {
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let i = start; i < trimmed.length; i++) {
			const ch = trimmed[i];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) {
					try {
						return JSON.parse(trimmed.slice(start, i + 1));
					} catch {
						// continue scanning
					}
				}
			}
		}
	}

	throw new Error("No valid JSON found in response text");
}

/**
 * Produce a JSON example string from a Zod schema so the LLM knows the
 * expected structure when JSON mode is unavailable.
 */
export function zodSchemaToJsonExample(schema: ZodType): string {
	return JSON.stringify(walkZod(schema), null, 2);
}

function walkZod(schema: ZodType): unknown {
	// biome-ignore lint/suspicious/noExplicitAny: Zod _def is internal API
	const def = (schema as any)._def;
	const typeName: string | undefined = def?.typeName;

	switch (typeName) {
		case "ZodString":
			return "<string>";
		case "ZodNumber":
			return "<number>";
		case "ZodBoolean":
			return "<boolean>";
		case "ZodEnum":
			return `<${(def.values as string[]).join(" | ")}>`;
		case "ZodArray":
			return [walkZod(def.type)];
		case "ZodObject": {
			const shape = def.shape?.() ?? {};
			const result: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(shape)) {
				result[key] = walkZod(value as ZodType);
			}
			return result;
		}
		case "ZodOptional":
		case "ZodNullable":
			return walkZod(def.innerType);
		case "ZodDefault":
			return walkZod(def.innerType);
		default:
			return "<unknown>";
	}
}

export interface StructuredFallbackOptions<T> extends GenerateStructuredOptions<T> {
	provider: LLMProvider;
}

/**
 * Try native generateStructured first; on failure fall back to
 * generateText + manual JSON extraction + Zod validation.
 */
export async function generateStructuredWithFallback<T>(
	opts: StructuredFallbackOptions<T>,
): Promise<GenerateStructuredResult<T>> {
	const { provider, ...structuredOpts } = opts;

	// 1. Try native structured generation
	try {
		return await provider.generateStructured(structuredOpts);
	} catch (primaryError) {
		console.log(
			"[provider] structured generation failed, attempting text fallback:",
			primaryError instanceof Error ? primaryError.message : String(primaryError),
		);
	}

	// 2. Fallback: generate text with schema instructions
	try {
		const schemaExample = zodSchemaToJsonExample(opts.schema);
		const fallbackInstruction = `Respond with ONLY a valid JSON object matching this exact schema (no extra text, no markdown fences):\n${schemaExample}`;

		const fallbackMessages: LLMMessage[] = [
			...opts.messages,
			{ role: "user", content: fallbackInstruction },
		];

		const textResult = await provider.generate({
			model: opts.model,
			messages: fallbackMessages,
			temperature: opts.temperature,
			maxTokens: opts.maxTokens,
		});

		const raw = extractJsonFromText(textResult.text);
		const parsed = opts.schema.parse(raw) as T;

		console.log("[provider] structured fallback succeeded");

		return {
			object: parsed,
			usage: textResult.usage,
			finishReason: textResult.finishReason,
		};
	} catch (fallbackError) {
		console.error(
			"[provider] structured fallback also failed:",
			fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
		);
		// Re-throw — callers already handle extraction errors
		throw fallbackError;
	}
}
