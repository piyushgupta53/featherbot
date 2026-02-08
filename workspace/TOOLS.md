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

Edit a specific range of lines in a file.

Example: `edit_file({ path: "config.json", startLine: 3, endLine: 5, content: "new content" })`

## list_dir

List files and directories at a given path.

Example: `list_dir({ path: "." })`
