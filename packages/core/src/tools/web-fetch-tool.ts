import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { z } from "zod";
import type { Tool } from "./types.js";

export interface WebFetchToolOptions {
	maxContentLength: number;
	timeoutMs: number;
}

export class WebFetchTool implements Tool {
	readonly name = "web_fetch";
	readonly description =
		"Fetch a URL and extract its content. HTML pages are cleaned for readability. JSON is pretty-printed.";
	readonly parameters = z.object({
		url: z.string().describe("The URL to fetch"),
		mode: z
			.enum(["text", "markdown"])
			.optional()
			.describe("Output mode: text (default) or markdown"),
	});

	private options: WebFetchToolOptions;

	constructor(options: WebFetchToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const { url } = params as { url: string; mode?: string };

		const validation = validateUrl(url);
		if (validation !== undefined) {
			return validation;
		}

		try {
			const response = await fetch(url, {
				headers: {
					"User-Agent": "FeatherBot/1.0",
					Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
				},
				redirect: "follow",
				signal: AbortSignal.timeout(this.options.timeoutMs),
			});

			if (!response.ok) {
				return `Error: HTTP ${response.status} ${response.statusText}`;
			}

			const contentType = response.headers.get("content-type") ?? "text/plain";
			const rawBody = await response.text();
			let content: string;

			if (contentType.includes("application/json")) {
				content = formatJson(rawBody);
			} else if (contentType.includes("text/html")) {
				content = extractReadableContent(rawBody);
			} else {
				content = rawBody;
			}

			content = truncate(content, this.options.maxContentLength);

			const header = [
				`URL: ${url}`,
				`Content-Type: ${contentType}`,
				`Length: ${content.length} chars`,
			].join("\n");

			return `${header}\n\n${content}`;
		} catch (err) {
			if (err instanceof DOMException && err.name === "TimeoutError") {
				return `Error: Request timed out after ${this.options.timeoutMs}ms`;
			}
			const message = err instanceof Error ? err.message : String(err);
			return `Error: Fetch failed — ${message}`;
		}
	}
}

function validateUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return `Error: Invalid URL scheme "${parsed.protocol}" — only http and https are supported`;
		}
		return undefined;
	} catch {
		return `Error: Invalid URL "${url}"`;
	}
}

function formatJson(raw: string): string {
	try {
		const parsed = JSON.parse(raw);
		return JSON.stringify(parsed, null, 2);
	} catch {
		return raw;
	}
}

function extractReadableContent(html: string): string {
	try {
		const { document } = parseHTML(html);
		// biome-ignore lint/suspicious/noExplicitAny: linkedom Document is compatible but not identical to DOM Document
		const reader = new Readability(document as any, { charThreshold: 0 });
		const article = reader.parse();
		if (article === null) {
			return stripTags(html);
		}

		const parts: string[] = [];
		if (article.title) {
			parts.push(article.title);
			parts.push("");
		}
		if (article.byline) {
			parts.push(`By: ${article.byline}`);
			parts.push("");
		}
		if (article.textContent) {
			parts.push(article.textContent.trim());
		}
		return parts.join("\n");
	} catch {
		return stripTags(html);
	}
}

function stripTags(html: string): string {
	return html
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function truncate(content: string, maxLength: number): string {
	if (content.length <= maxLength) {
		return content;
	}
	return `${content.slice(0, maxLength)}\n[Truncated...]`;
}
