import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirecrawlSearchTool } from "./firecrawl-search-tool.js";

describe("FirecrawlSearchTool", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function createTool(apiKey = "fc-test-key") {
		return new FirecrawlSearchTool({ apiKey, maxResults: 5 });
	}

	it("returns error when API key is empty", async () => {
		const tool = createTool("");
		const result = await tool.execute({ query: "test" });
		expect(result).toContain("Error");
		expect(result).toContain("No API key configured for Firecrawl");
	});

	it("has correct name and description", () => {
		const tool = createTool();
		expect(tool.name).toBe("firecrawl_search");
		expect(tool.description).toContain("Firecrawl");
	});

	it("sends correct request to Firecrawl API", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				data: [{ url: "https://example.com", title: "Example", description: "A test" }],
			}),
		});
		globalThis.fetch = mockFetch;

		const tool = createTool();
		await tool.execute({ query: "test query", limit: 3 });

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.firecrawl.dev/v2/search",
			expect.objectContaining({
				method: "POST",
				headers: {
					Authorization: "Bearer fc-test-key",
					"Content-Type": "application/json",
				},
			}),
		);

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.query).toBe("test query");
		expect(body.limit).toBe(3);
	});

	it("formats results with title, URL, and description", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				data: [
					{
						url: "https://example.com",
						title: "Example Page",
						description: "A test page",
						markdown: "# Hello World",
					},
				],
			}),
		});

		const tool = createTool();
		const result = await tool.execute({ query: "test" });

		expect(result).toContain("Example Page");
		expect(result).toContain("https://example.com");
		expect(result).toContain("A test page");
		expect(result).toContain("# Hello World");
	});

	it("returns no results message when data is empty", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true, data: [] }),
		});

		const tool = createTool();
		const result = await tool.execute({ query: "obscure query" });
		expect(result).toContain("No results found");
	});

	it("returns error on non-ok HTTP response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
		});

		const tool = createTool();
		const result = await tool.execute({ query: "test" });
		expect(result).toContain("Error");
		expect(result).toContain("429");
	});

	it("returns error on network failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

		const tool = createTool();
		const result = await tool.execute({ query: "test" });
		expect(result).toContain("Error");
		expect(result).toContain("Network error");
	});

	it("uses maxResults from options when limit not provided", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true, data: [] }),
		});
		globalThis.fetch = mockFetch;

		const tool = new FirecrawlSearchTool({ apiKey: "fc-key", maxResults: 7 });
		await tool.execute({ query: "test" });

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.limit).toBe(7);
	});

	it("truncates long markdown content", async () => {
		const longMarkdown = "x".repeat(3000);
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				data: [{ url: "https://example.com", title: "Long", markdown: longMarkdown }],
			}),
		});

		const tool = createTool();
		const result = await tool.execute({ query: "test" });
		expect(result).toContain("[Truncated...]");
	});

	it("handles grouped response format (data.web instead of data array)", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				data: {
					web: [
						{
							url: "https://example.com/cricket",
							title: "Cricket Schedule",
							description: "T20 World Cup schedule",
						},
					],
					news: [
						{
							url: "https://news.example.com/t20",
							title: "T20 Update",
							snippet: "Latest T20 news",
						},
					],
				},
			}),
		});

		const tool = createTool();
		const result = await tool.execute({ query: "T20 World Cup" });

		expect(result).toContain("Cricket Schedule");
		expect(result).toContain("https://example.com/cricket");
		expect(result).toContain("T20 Update");
		expect(result).toContain("Latest T20 news");
		expect(result).toContain("Result 1");
		expect(result).toContain("Result 2");
	});

	it("returns no results when grouped format has empty web array", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				data: { web: [], news: [] },
			}),
		});

		const tool = createTool();
		const result = await tool.execute({ query: "obscure query" });
		expect(result).toContain("No results found");
	});

	it("handles success: false response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false }),
		});

		const tool = createTool();
		const result = await tool.execute({ query: "test" });
		expect(result).toContain("No results found");
	});
});
