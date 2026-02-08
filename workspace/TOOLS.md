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
- `add` — Create a new scheduled job. Requires: `name`, `message`, and exactly one of `cronExpr`, `everySeconds`, or `at`.
- `list` — List all existing scheduled jobs.
- `remove` — Remove a job by ID. Requires: `jobId`.
- `enable` / `disable` — Toggle a job. Requires: `jobId`.

**Examples:**

Create a daily job at 9 AM:
  `cron({ action: "add", name: "Daily weather", message: "Check the weather forecast", cronExpr: "0 9 * * *" })`

Create a recurring job every 5 minutes:
  `cron({ action: "add", name: "Health check", message: "Check system health", everySeconds: 300 })`

Create a one-time reminder:
  `cron({ action: "add", name: "Meeting reminder", message: "Team meeting in 15 minutes", at: "2026-02-10T14:45:00Z" })`

List all jobs: `cron({ action: "list" })`
Remove a job: `cron({ action: "remove", jobId: "the-job-id" })`

**Important:** To create a job you MUST use `action: "add"`. Listing does not create anything.

## web_search

Search the web using Brave Search API. Returns titles, URLs, descriptions.

Example: `web_search({ query: "weather in San Francisco" })`

## web_fetch

Fetch a URL and extract readable content.

Example: `web_fetch({ url: "https://example.com/article" })`
