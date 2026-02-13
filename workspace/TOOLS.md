# Available Tools

## exec

Run a shell command. Has a configurable timeout (default 60s).

Example: `exec({ command: "ls -la" })`

## read_file

Read the contents of a file.

Example: `read_file({ path: "notes.md" })`

## write_file

Write content to a file. Creates parent directories if needed.

Example: `write_file({ path: "hello.txt", content: "Hello world" })`

## edit_file

Edit a file by replacing an exact text match. The old text must appear exactly once.

Example: `edit_file({ path: "USER.md", oldText: "- Name: (your name here)", newText: "- Name: Alice" })`

## list_dir

List files and directories at a given path.

Example: `list_dir({ path: "." })`

## cron

Manage scheduled tasks. The `action` parameter determines the operation.

**Actions:**
- `add` — Create a new scheduled job. Requires: `name`, `message`, and exactly one of `cronExpr`, `everySeconds`, `at`, or `relativeMinutes`.
- `list` — List all existing scheduled jobs.
- `remove` — Remove a job by ID. Requires: `jobId`.
- `enable` / `disable` — Toggle a job. Requires: `jobId`.

**Examples:**

Create a daily job at 9 AM:
  `cron({ action: "add", name: "Daily weather", message: "Check the weather forecast", cronExpr: "0 9 * * *" })`

Create a recurring job every 5 minutes:
  `cron({ action: "add", name: "Health check", message: "Check system health", everySeconds: 300 })`

Create a one-time reminder at a specific time:
  `cron({ action: "add", name: "Meeting reminder", message: "Team meeting in 15 minutes", at: "2026-02-10T14:45:00" })`

Create a reminder in 30 minutes:
  `cron({ action: "add", name: "Quick reminder", message: "Check the build", relativeMinutes: 30 })`

List all jobs: `cron({ action: "list" })`
Remove a job: `cron({ action: "remove", jobId: "the-job-id" })`

**Important:** To create a job you MUST use `action: "add"`. Listing does not create anything.

## recall_recent

Retrieve daily notes from recent days. Use this to recall what happened in past sessions.

Example: `recall_recent({ days: 7 })`

The `days` parameter is optional (default 7, max 30).

## web_search

Search the web using Brave Search API. Returns titles, URLs, and short descriptions. Fast and lightweight — use this for quick lookups where you just need links or brief answers.

Example: `web_search({ query: "weather in San Francisco" })`

## web_fetch

Fetch a single URL and extract readable content. Use this when you already have a specific URL.

Example: `web_fetch({ url: "https://example.com/article" })`

## firecrawl_search

Search the web AND scrape full page content from each result. Use this instead of web_search when you need detailed content from results (not just titles/descriptions). More thorough but uses more credits.

Example: `firecrawl_search({ query: "how to configure nginx reverse proxy", limit: 3 })`

**When to prefer over web_search:** Research tasks, summarizing multiple sources, when titles/descriptions aren't enough.

## firecrawl_crawl

Crawl a website starting from a URL — follows links and scrapes multiple pages as markdown. Use this to index documentation sites, explore a multi-page resource, or gather content from several pages of a site.

Example: `firecrawl_crawl({ url: "https://docs.example.com", limit: 5 })`

**When to use:** When the user asks about a website's content across multiple pages, or when you need to understand a documentation site, blog, or multi-page resource.
