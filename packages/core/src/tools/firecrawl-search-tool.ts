import { z } from "zod";
import type { Tool } from "./types.js";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";

export interface FirecrawlSearchToolOptions {
	apiKey: string;
	maxResults: number;
}

export class FirecrawlSearchTool implements Tool {
	readonly name = "firecrawl_search";
	readonly description =
		"Search the web using Firecrawl and get scraped markdown content from each result. More thorough than basic web search.";
	readonly parameters = z.object({
		query: z.string().describe("The search query"),
		limit: z
			.number()
			.int()
			.min(1)
			.max(10)
			.optional()
			.describe("Number of results to return (1-10)"),
	});

	private options: FirecrawlSearchToolOptions;

	constructor(options: FirecrawlSearchToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const { query, limit } = params as {
			query: string;
			limit?: number;
		};

		if (this.options.apiKey === "") {
			return "Error: No API key configured for Firecrawl. Set tools.web.firecrawl.apiKey in config.";
		}

		const resultCount = limit ?? this.options.maxResults;

		try {
			const response = await fetch(FIRECRAWL_SEARCH_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.options.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					query,
					limit: resultCount,
					scrapeOptions: { formats: ["markdown"] },
				}),
			});

			if (!response.ok) {
				return `Error: Firecrawl Search API returned ${response.status} ${response.statusText}`;
			}

			const data = (await response.json()) as FirecrawlSearchResponse;

			if (!data.success || !data.data || data.data.length === 0) {
				return `No results found for "${query}"`;
			}

			const lines: string[] = [`Firecrawl search results for "${query}":\n`];
			for (let i = 0; i < data.data.length; i++) {
				const r = data.data[i];
				if (r === undefined) continue;
				lines.push(`--- Result ${i + 1} ---`);
				if (r.title) lines.push(`Title: ${r.title}`);
				if (r.url) lines.push(`URL: ${r.url}`);
				if (r.description) lines.push(`Description: ${r.description}`);
				if (r.markdown) {
					const trimmed =
						r.markdown.length > 2000 ? `${r.markdown.slice(0, 2000)}\n[Truncated...]` : r.markdown;
					lines.push(`\nContent:\n${trimmed}`);
				}
				lines.push("");
			}

			return lines.join("\n").trim();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error: Firecrawl search failed \u2014 ${message}`;
		}
	}
}

interface FirecrawlSearchResult {
	url?: string;
	title?: string;
	description?: string;
	markdown?: string;
}

interface FirecrawlSearchResponse {
	success: boolean;
	data?: FirecrawlSearchResult[];
}
