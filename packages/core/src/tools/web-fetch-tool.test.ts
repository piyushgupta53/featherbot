import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebFetchTool } from "./web-fetch-tool.js";

const DEFAULT_OPTIONS = { maxContentLength: 50000, timeoutMs: 30000 };

function mockResponse(body: string, contentType = "text/html", status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Not Found",
		headers: new Map([["content-type", contentType]]),
		text: () => Promise.resolve(body),
	};
}

describe("WebFetchTool", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("has correct name and description", () => {
		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		expect(tool.name).toBe("web_fetch");
		expect(tool.description).toContain("Fetch a URL");
	});

	it("has correct parameter schema", () => {
		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const shape = tool.parameters.shape;
		expect(shape.url).toBeDefined();
		expect(shape.mode).toBeDefined();
	});

	it("rejects invalid URL", async () => {
		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "not-a-url" });
		expect(result).toContain("Error: Invalid URL");
	});

	it("rejects non-http schemes", async () => {
		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "ftp://example.com/file" });
		expect(result).toContain('Invalid URL scheme "ftp:"');
	});

	it("extracts readable content from HTML", async () => {
		const html = `
			<html><head><title>Test Article</title></head>
			<body>
				<article>
					<h1>Test Article</h1>
					<p>This is the main content of the article. It has enough text to be extracted by readability. This paragraph is intentionally long to ensure readability picks it up as the main content of the page and does not skip it.</p>
				</article>
			</body></html>
		`;
		globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(html));

		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "https://example.com/article" });

		expect(result).toContain("URL: https://example.com/article");
		expect(result).toContain("Content-Type: text/html");
		expect(result).toContain("Length:");
	});

	it("pretty-prints JSON responses", async () => {
		const json = '{"name":"test","value":42}';
		globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(json, "application/json"));

		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "https://api.example.com/data" });

		expect(result).toContain("Content-Type: application/json");
		expect(result).toContain('"name": "test"');
		expect(result).toContain('"value": 42');
	});

	it("returns raw text for plain text responses", async () => {
		const text = "Hello, this is plain text content.";
		globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(text, "text/plain"));

		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "https://example.com/plain.txt" });

		expect(result).toContain("Content-Type: text/plain");
		expect(result).toContain("Hello, this is plain text content.");
	});

	it("truncates content exceeding maxContentLength", async () => {
		const longContent = "x".repeat(100);
		globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(longContent, "text/plain"));

		const tool = new WebFetchTool({ maxContentLength: 50, timeoutMs: 30000 });
		const result = await tool.execute({ url: "https://example.com/long" });

		expect(result).toContain("[Truncated...]");
		expect(result).toContain("Length: 65 chars");
	});

	it("returns error on HTTP error status", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});

		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "https://example.com/missing" });

		expect(result).toBe("Error: HTTP 404 Not Found");
	});

	it("returns error on network failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "https://example.com" });

		expect(result).toBe("Error: Fetch failed — ECONNREFUSED");
	});

	it("returns error on timeout", async () => {
		const timeoutError = new DOMException("The operation was aborted.", "TimeoutError");
		globalThis.fetch = vi.fn().mockRejectedValue(timeoutError);

		const tool = new WebFetchTool({ maxContentLength: 50000, timeoutMs: 5000 });
		const result = await tool.execute({ url: "https://slow.example.com" });

		expect(result).toBe("Error: Request timed out after 5000ms");
	});

	it("handles invalid JSON gracefully", async () => {
		const badJson = "{not valid json}}}";
		globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(badJson, "application/json"));

		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "https://example.com/bad" });

		expect(result).toContain(badJson);
	});

	it("strips script and style tags in fallback extraction", async () => {
		const html =
			"<html><body><script>alert('xss')</script><style>.x{}</style><p>Hello</p></body></html>";
		globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(html));

		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "https://example.com/page" });

		expect(result).not.toContain("alert");
		expect(result).not.toContain(".x{}");
	});

	it("includes metadata header in response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(mockResponse("content", "text/plain"));

		const tool = new WebFetchTool(DEFAULT_OPTIONS);
		const result = await tool.execute({ url: "https://example.com/test" });

		const lines = result.split("\n");
		expect(lines[0]).toBe("URL: https://example.com/test");
		expect(lines[1]).toBe("Content-Type: text/plain");
		expect(lines[2]).toMatch(/^Length: \d+ chars$/);
	});
});
