import { z } from "zod";
import type { Tool } from "./types.js";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

function normalizeYearForRecency(query: string): { effectiveQuery: string; rewritten: boolean } {
	const nowYear = new Date().getUTCFullYear();
	const yearMatches = [...query.matchAll(/\b(20\d{2})\b/g)];
	if (yearMatches.length === 0) {
		return { effectiveQuery: query, rewritten: false };
	}
	const hasPastIntent = /\b(history|historical|archive|archived|last year|previous year)\b/i.test(
		query,
	);
	if (hasPastIntent) {
		return { effectiveQuery: query, rewritten: false };
	}
	const hasRecencyCue =
		/\b(latest|current|today|recent|new|upcoming|this year|now)\b/i.test(query) ||
		/\b(summit|conference|event|meetup|expo)\b/i.test(query);
	if (!hasRecencyCue) {
		return { effectiveQuery: query, rewritten: false };
	}
	let rewritten = false;
	const effectiveQuery = query.replace(/\b(20\d{2})\b/g, (raw) => {
		const year = Number.parseInt(raw, 10);
		if (Number.isNaN(year) || year >= nowYear) {
			return raw;
		}
		rewritten = true;
		return String(nowYear);
	});
	return { effectiveQuery, rewritten };
}

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
		const { effectiveQuery, rewritten } = normalizeYearForRecency(query);
		if (rewritten) {
			console.log(
				`[metrics] web_search_query_rewritten_year from="${query}" to="${effectiveQuery}"`,
			);
		}

		if (this.options.apiKey === "") {
			return "Error: No API key configured for web search. Set tools.web.search.apiKey in config.";
		}

		const resultCount = count ?? this.options.maxResults;
		const url = `${BRAVE_API_URL}?q=${encodeURIComponent(effectiveQuery)}&count=${resultCount}`;

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
				return `No results found for "${effectiveQuery}"`;
			}

			const lines: string[] = [`Search results for "${effectiveQuery}":\n`];
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
