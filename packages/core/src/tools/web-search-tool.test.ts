import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSearchTool } from "./web-search-tool.js";

const DEFAULT_OPTIONS = { apiKey: "test-brave-key", maxResults: 5 };

describe("WebSearchTool", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("has correct name and description", () => {
		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		expect(tool.name).toBe("web_search");
		expect(tool.description).toContain("Brave Search");
	});

	it("has correct parameter schema", () => {
		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		const shape = tool.parameters.shape;
		expect(shape.query).toBeDefined();
		expect(shape.count).toBeDefined();
	});

	it("returns error when apiKey is empty", async () => {
		const tool = new WebSearchTool({ apiKey: "", maxResults: 5 });
		const result = await tool.execute({ query: "test" });
		expect(result).toContain("Error: No API key configured");
	});

	it("returns formatted results on success", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					web: {
						results: [
							{
								title: "Example Page",
								url: "https://example.com",
								description: "An example page",
							},
							{
								title: "Another Page",
								url: "https://another.com",
								description: "Another result",
							},
						],
					},
				}),
		});

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ query: "test query" });

		expect(result).toContain('Search results for "test query"');
		expect(result).toContain("1. Example Page");
		expect(result).toContain("   https://example.com");
		expect(result).toContain("   An example page");
		expect(result).toContain("2. Another Page");
		expect(result).toContain("   https://another.com");
	});

	it("sends correct API request", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ web: { results: [] } }),
		});
		globalThis.fetch = mockFetch;

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		await tool.execute({ query: "hello world", count: 3 });

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("q=hello%20world"),
			expect.objectContaining({
				headers: expect.objectContaining({
					"X-Subscription-Token": "test-brave-key",
				}),
			}),
		);
		expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("count=3"), expect.anything());
	});

	it("uses config maxResults when count not specified", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ web: { results: [] } }),
		});
		globalThis.fetch = mockFetch;

		const tool = new WebSearchTool({ apiKey: "key", maxResults: 7 });
		await tool.execute({ query: "test" });

		expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("count=7"), expect.anything());
	});

	it("returns no results message when API returns empty results", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ web: { results: [] } }),
		});

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ query: "obscure query" });

		expect(result).toBe('No results found for "obscure query"');
	});

	it("returns no results when web field is missing", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
		});

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ query: "test" });

		expect(result).toBe('No results found for "test"');
	});

	it("returns error on API HTTP error", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
		});

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ query: "test" });

		expect(result).toBe("Error: Brave Search API returned 429 Too Many Requests");
	});

	it("returns error on network failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ query: "test" });

		expect(result).toBe("Error: Web search failed — fetch failed");
	});

	it("handles results without description", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					web: {
						results: [
							{
								title: "No Desc Page",
								url: "https://nodesc.com",
							},
						],
					},
				}),
		});

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ query: "test" });

		expect(result).toContain("1. No Desc Page");
		expect(result).toContain("   https://nodesc.com");
		expect(result).not.toContain("undefined");
	});

	it("rewrites stale event year queries to current year", async () => {
		const currentYear = new Date().getUTCFullYear();
		const staleYear = currentYear - 1;
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ web: { results: [] } }),
		});
		globalThis.fetch = mockFetch;

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		await tool.execute({ query: `AI summit Delhi ${staleYear}` });

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining(`q=${encodeURIComponent(`AI summit Delhi ${currentYear}`)}`),
			expect.anything(),
		);
	});

	it("does not rewrite explicitly historical queries", async () => {
		const currentYear = new Date().getUTCFullYear();
		const staleYear = currentYear - 1;
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ web: { results: [] } }),
		});
		globalThis.fetch = mockFetch;

		const tool = new WebSearchTool(DEFAULT_OPTIONS);
		await tool.execute({ query: `AI summit Delhi ${staleYear} history` });

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining(`q=${encodeURIComponent(`AI summit Delhi ${staleYear} history`)}`),
			expect.anything(),
		);
	});
});
