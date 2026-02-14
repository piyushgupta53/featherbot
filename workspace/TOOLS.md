# Available Tools

## Workspace Directories

- **data/** — Persistent outputs (scripts, reports, exports, downloads). Files here are kept across restarts.
- **scratch/** — Temporary work area (package installs, builds, intermediate files). Auto-cleaned on startup (files older than 7 days are removed). This is the default working directory for `exec`.
- **memory/** — Memory files managed automatically. Do not edit directly.

Do not create files in the workspace root — it is reserved for bootstrap configuration files.

## exec

Run a shell command. Has a configurable timeout (default 60s). Defaults to `scratch/` as working directory when no `workingDir` is specified.

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

Manage scheduled tasks. When a job fires, the `message` is processed through the **full agent loop with all tools available** (web search, web fetch, exec, etc.) and the result is automatically sent to the user's channel. This is fully automated — no manual intervention needed.

The `action` parameter determines the operation.

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

## spawn

Run a task in the background using a specialized sub-agent. Returns immediately — the user gets a response right away while the sub-agent works. Results are delivered back to the user's channel when complete.

**Parameters:**
- `task` (required) — The task description for the sub-agent.
- `type` (optional) — Sub-agent specialization. One of:
  - `general` (default) — Full tool access. Good for tasks that need both research and file work.
  - `researcher` — Read-only + web tools. Best for web lookups, research, and information gathering. Cannot modify files.
  - `coder` — File + exec tools only. Best for writing code, editing files, running scripts. No web access.
  - `analyst` — Full tool access with data-focused prompt. Best for analyzing data, files, or comparing information.

**Sub-agent context:**
- Sub-agents receive the recent conversation context (last 5 message pairs) so they understand what the user has been discussing.
- Sub-agents receive the user's memory (from MEMORY.md) as read-only context.
- Sub-agents CANNOT spawn other sub-agents, manage cron jobs, or send messages (prevents recursion).

**Examples:**

Simple web research:
  `spawn({ task: "Search for the latest Node.js LTS version and summarize what's new", type: "researcher" })`

Code task:
  `spawn({ task: "Write a Python script to parse CSV files in data/", type: "coder" })`

Data analysis:
  `spawn({ task: "Analyze the log files in data/logs/ and summarize error patterns", type: "analyst" })`

## subagent_status

Check on background sub-agents or cancel a running one.

**Parameters:**
- `id` (optional) — Specific sub-agent task ID to check or cancel.
- `action` (optional) — `status` (default) or `cancel`.

**Examples:**
- `subagent_status({})` — list all active sub-agents
- `subagent_status({ id: "some-task-id" })` — check a specific task
- `subagent_status({ action: "cancel", id: "some-task-id" })` — cancel a running sub-agent

## recall_recent

Retrieve daily notes from recent days. Use this to recall what happened in past sessions.

Example: `recall_recent({ days: 7 })`

The `days` parameter is optional (default 7, max 30).

## todo

Manage a structured todo list for tracking tasks during conversations.

**Actions:**
- `add` — Add a new todo item. Requires: `text`.
- `list` — List all todo items with their status.
- `complete` — Mark a todo as done. Requires: `id`.
- `delete` — Remove a todo item. Requires: `id`.

**Examples:**

Add a task: `todo({ action: "add", text: "Set up dev environment" })`
List tasks: `todo({ action: "list" })`
Complete a task: `todo({ action: "complete", id: 1 })`
Delete a task: `todo({ action: "delete", id: 2 })`

**When to use:** For multi-step tasks where progress tracking is useful (planning, setup guides, project checklists). Data is stored in `data/todos.json`.

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
