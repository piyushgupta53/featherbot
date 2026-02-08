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
