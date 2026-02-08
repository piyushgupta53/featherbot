import { z } from "zod";
import type { Tool } from "./types.js";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

export interface WebSearchToolOptions {
	apiKey: string;
	maxResults: number;
}

export class WebSearchTool implements Tool {
	readonly name = "web_search";
	readonly description =
		"Search the web using Brave Search API. Returns a list of results with titles, URLs, and descriptions.";
	readonly parameters = z.object({
		query: z.string().describe("The search query"),
		count: z
			.number()
			.int()
			.min(1)
			.max(10)
			.optional()
			.describe("Number of results to return (1-10)"),
	});

	private options: WebSearchToolOptions;

	constructor(options: WebSearchToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const { query, count } = params as {
			query: string;
			count?: number;
		};

		if (this.options.apiKey === "") {
			return "Error: No API key configured for web search. Set tools.web.search.apiKey in config.";
		}

		const resultCount = count ?? this.options.maxResults;
		const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${resultCount}`;

		try {
			const response = await fetch(url, {
				headers: {
					"X-Subscription-Token": this.options.apiKey,
					Accept: "application/json",
				},
			});

			if (!response.ok) {
				return `Error: Brave Search API returned ${response.status} ${response.statusText}`;
			}

			const data = (await response.json()) as BraveSearchResponse;
			const results = data.web?.results;

			if (results === undefined || results.length === 0) {
				return `No results found for "${query}"`;
			}

			const lines: string[] = [`Search results for "${query}":\n`];
			for (let i = 0; i < results.length; i++) {
				const r = results[i];
				if (r === undefined) continue;
				lines.push(`${i + 1}. ${r.title}`);
				lines.push(`   ${r.url}`);
				if (r.description) {
					lines.push(`   ${r.description}`);
				}
				lines.push("");
			}

			return lines.join("\n").trim();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error: Web search failed — ${message}`;
		}
	}
}

interface BraveSearchResult {
	title: string;
	url: string;
	description?: string;
}

interface BraveSearchResponse {
	web?: {
		results?: BraveSearchResult[];
	};
}
