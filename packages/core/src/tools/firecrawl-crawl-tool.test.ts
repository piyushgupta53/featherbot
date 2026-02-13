import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirecrawlCrawlTool } from "./firecrawl-crawl-tool.js";

describe("FirecrawlCrawlTool", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
		vi.useFakeTimers();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.useRealTimers();
	});

	function createTool(apiKey = "fc-test-key") {
		return new FirecrawlCrawlTool({
			apiKey,
			maxPages: 5,
			timeoutMs: 30000,
		});
	}

	it("returns error when API key is empty", async () => {
		vi.useRealTimers();
		const tool = createTool("");
		const result = await tool.execute({ url: "https://example.com" });
		expect(result).toContain("Error");
		expect(result).toContain("No API key configured for Firecrawl");
	});

	it("has correct name and description", () => {
		const tool = createTool();
		expect(tool.name).toBe("firecrawl_crawl");
		expect(tool.description).toContain("Crawl");
	});

	it("sends correct start request", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, id: "job-123" }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					status: "completed",
					data: [
						{
							markdown: "# Page 1",
							metadata: { title: "Page 1", sourceURL: "https://example.com" },
						},
					],
				}),
			});
		globalThis.fetch = mockFetch;

		const tool = createTool();
		const resultPromise = tool.execute({ url: "https://example.com", limit: 3 });
		await vi.advanceTimersByTimeAsync(3000);
		await resultPromise;

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.firecrawl.dev/v2/crawl",
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
		expect(body.url).toBe("https://example.com");
		expect(body.limit).toBe(3);
	});

	it("polls until completed and returns formatted results", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, id: "job-456" }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "scraping", completed: 1, total: 3 }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					status: "completed",
					data: [
						{
							markdown: "# Home",
							metadata: { title: "Home Page", sourceURL: "https://example.com" },
						},
						{
							markdown: "# About",
							metadata: { title: "About Page", sourceURL: "https://example.com/about" },
						},
					],
				}),
			});
		globalThis.fetch = mockFetch;

		const tool = createTool();
		const resultPromise = tool.execute({ url: "https://example.com" });

		// Advance past first poll (scraping) and second poll (completed)
		await vi.advanceTimersByTimeAsync(3000);
		await vi.advanceTimersByTimeAsync(3000);
		const result = await resultPromise;

		expect(result).toContain("2 page(s)");
		expect(result).toContain("Home Page");
		expect(result).toContain("About Page");
		expect(result).toContain("# Home");
		expect(result).toContain("# About");
	});

	it("returns error when start request fails", async () => {
		vi.useRealTimers();
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
		});

		const tool = createTool();
		const result = await tool.execute({ url: "https://example.com" });
		expect(result).toContain("Error");
		expect(result).toContain("500");
	});

	it("returns error when crawl job fails", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, id: "job-789" }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "failed" }),
			});
		globalThis.fetch = mockFetch;

		const tool = createTool();
		const resultPromise = tool.execute({ url: "https://example.com" });
		await vi.advanceTimersByTimeAsync(3000);
		const result = await resultPromise;

		expect(result).toContain("Error");
		expect(result).toContain("crawl job failed");
	});

	it("returns error on network failure", async () => {
		vi.useRealTimers();
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

		const tool = createTool();
		const result = await tool.execute({ url: "https://example.com" });
		expect(result).toContain("Error");
		expect(result).toContain("Connection refused");
	});

	it("returns error when start response has success: false", async () => {
		vi.useRealTimers();
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false }),
		});

		const tool = createTool();
		const result = await tool.execute({ url: "https://example.com" });
		expect(result).toContain("Error");
		expect(result).toContain("failed to start crawl job");
	});

	it("handles completed crawl with no pages", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, id: "job-empty" }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "completed", data: [] }),
			});
		globalThis.fetch = mockFetch;

		const tool = createTool();
		const resultPromise = tool.execute({ url: "https://example.com" });
		await vi.advanceTimersByTimeAsync(3000);
		const result = await resultPromise;

		expect(result).toContain("completed but returned no pages");
	});

	it("uses maxPages from options when limit not provided", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, id: "job-def" }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "completed", data: [] }),
			});
		globalThis.fetch = mockFetch;

		const tool = new FirecrawlCrawlTool({ apiKey: "fc-key", maxPages: 10, timeoutMs: 30000 });
		const resultPromise = tool.execute({ url: "https://example.com" });
		await vi.advanceTimersByTimeAsync(3000);
		await resultPromise;

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.limit).toBe(10);
	});

	it("returns timeout error when crawl exceeds timeoutMs", async () => {
		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ success: true, id: "job-slow" }),
		});
		// All polls return "scraping" so it never completes
		for (let i = 0; i < 20; i++) {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "scraping", completed: 1, total: 10 }),
			});
		}
		globalThis.fetch = mockFetch;

		const tool = new FirecrawlCrawlTool({ apiKey: "fc-key", maxPages: 5, timeoutMs: 10000 });
		const resultPromise = tool.execute({ url: "https://example.com" });

		// Advance past the timeout
		await vi.advanceTimersByTimeAsync(15000);
		const result = await resultPromise;

		expect(result).toContain("Error");
		expect(result).toContain("timed out");
	});
});
