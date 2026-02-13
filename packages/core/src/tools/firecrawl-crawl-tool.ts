import { z } from "zod";
import type { Tool } from "./types.js";

const FIRECRAWL_CRAWL_URL = "https://api.firecrawl.dev/v2/crawl";
const POLL_INTERVAL_MS = 3000;

export interface FirecrawlCrawlToolOptions {
	apiKey: string;
	maxPages: number;
	timeoutMs: number;
}

export class FirecrawlCrawlTool implements Tool {
	readonly name = "firecrawl_crawl";
	readonly description =
		"Crawl a website using Firecrawl. Starts from a URL and follows links to scrape multiple pages as markdown.";
	readonly parameters = z.object({
		url: z.string().describe("The starting URL to crawl"),
		limit: z
			.number()
			.int()
			.min(1)
			.max(50)
			.optional()
			.describe("Maximum number of pages to crawl (1-50)"),
	});

	private options: FirecrawlCrawlToolOptions;

	constructor(options: FirecrawlCrawlToolOptions) {
		this.options = options;
	}

	async execute(params: Record<string, unknown>): Promise<string> {
		const { url, limit } = params as {
			url: string;
			limit?: number;
		};

		if (this.options.apiKey === "") {
			return "Error: No API key configured for Firecrawl. Set tools.web.firecrawl.apiKey in config.";
		}

		const pageLimit = limit ?? this.options.maxPages;

		try {
			// Step 1: Start crawl job
			const startResponse = await fetch(FIRECRAWL_CRAWL_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.options.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					url,
					limit: pageLimit,
					scrapeOptions: { formats: ["markdown"] },
				}),
			});

			if (!startResponse.ok) {
				return `Error: Firecrawl Crawl API returned ${startResponse.status} ${startResponse.statusText}`;
			}

			const startData = (await startResponse.json()) as FirecrawlCrawlStartResponse;

			if (!startData.success || !startData.id) {
				return "Error: Firecrawl failed to start crawl job";
			}

			// Step 2: Poll until complete or timeout
			const statusUrl = `${FIRECRAWL_CRAWL_URL}/${startData.id}`;
			const deadline = Date.now() + this.options.timeoutMs;

			while (Date.now() < deadline) {
				await sleep(POLL_INTERVAL_MS);

				const pollResponse = await fetch(statusUrl, {
					headers: {
						Authorization: `Bearer ${this.options.apiKey}`,
					},
				});

				if (!pollResponse.ok) {
					return `Error: Firecrawl status check returned ${pollResponse.status} ${pollResponse.statusText}`;
				}

				const status = (await pollResponse.json()) as FirecrawlCrawlStatusResponse;

				if (status.status === "failed") {
					return "Error: Firecrawl crawl job failed";
				}

				if (status.status === "completed") {
					return formatCrawlResults(url, status);
				}
			}

			return `Error: Firecrawl crawl timed out after ${this.options.timeoutMs}ms`;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error: Firecrawl crawl failed \u2014 ${message}`;
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCrawlResults(startUrl: string, status: FirecrawlCrawlStatusResponse): string {
	const pages = status.data ?? [];
	if (pages.length === 0) {
		return `Crawl of ${startUrl} completed but returned no pages.`;
	}

	const lines: string[] = [`Firecrawl crawl of ${startUrl} completed: ${pages.length} page(s)\n`];

	for (let i = 0; i < pages.length; i++) {
		const page = pages[i];
		if (page === undefined) continue;
		lines.push(`--- Page ${i + 1} ---`);
		if (page.metadata?.title) lines.push(`Title: ${page.metadata.title}`);
		if (page.metadata?.sourceURL) lines.push(`URL: ${page.metadata.sourceURL}`);
		if (page.markdown) {
			const trimmed =
				page.markdown.length > 3000
					? `${page.markdown.slice(0, 3000)}\n[Truncated...]`
					: page.markdown;
			lines.push(`\n${trimmed}`);
		}
		lines.push("");
	}

	return lines.join("\n").trim();
}

interface FirecrawlCrawlStartResponse {
	success: boolean;
	id?: string;
	url?: string;
}

interface FirecrawlCrawlStatusResponse {
	status: "scraping" | "completed" | "failed";
	total?: number;
	completed?: number;
	data?: FirecrawlCrawlPage[];
}

interface FirecrawlCrawlPage {
	markdown?: string;
	metadata?: {
		title?: string;
		sourceURL?: string;
		statusCode?: number;
		description?: string;
	};
}
