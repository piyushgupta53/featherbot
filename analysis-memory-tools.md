# Nanobot Architecture Analysis: Memory, Skills, and Tools Systems

## Table of Contents

1. [Memory System](#1-memory-system)
2. [Skills System](#2-skills-system)
3. [Tool Framework](#3-tool-framework)
4. [Built-in Tools](#4-built-in-tools)
5. [Context Assembly Pipeline](#5-context-assembly-pipeline)
6. [Subagent System](#6-subagent-system)
7. [Integration Map](#7-integration-map)
8. [Design Patterns and Takeaways](#8-design-patterns-and-takeaways)

---

## 1. Memory System

**Source:** `nanobot/agent/memory.py`

### 1.1 Architecture Overview

The memory system is a file-based, markdown-formatted persistence layer. There is no database, no vector store, no embedding search. Memory is plain text on disk, organized into two tiers:

| Tier | File Pattern | Purpose |
|------|-------------|---------|
| **Long-term** | `memory/MEMORY.md` | Persistent facts, preferences, identity notes |
| **Daily notes** | `memory/YYYY-MM-DD.md` | Ephemeral daily scratchpad per date |

### 1.2 Key Class: `MemoryStore`

```python
class MemoryStore:
    def __init__(self, workspace: Path):
        self.workspace = workspace
        self.memory_dir = ensure_dir(workspace / "memory")
        self.memory_file = self.memory_dir / "MEMORY.md"
```

**Constructor behavior:** On instantiation, it creates the `memory/` directory if it does not exist (via `ensure_dir`). The workspace path is the root project/bot directory.

### 1.3 Core Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `read_long_term()` | `() -> str` | Reads `MEMORY.md` in full |
| `write_long_term(content)` | `(str) -> None` | Overwrites `MEMORY.md` entirely |
| `read_today()` | `() -> str` | Reads today's date file |
| `append_today(content)` | `(str) -> None` | Appends to today's file; creates header `# YYYY-MM-DD` if new |
| `get_recent_memories(days=7)` | `(int) -> str` | Reads last N daily files, joined by `---` separators |
| `list_memory_files()` | `() -> list[Path]` | Glob `????-??-??.md`, sorted newest-first |
| `get_memory_context()` | `() -> str` | Assembles `## Long-term Memory` + `## Today's Notes` for prompt injection |

### 1.4 Memory Format

Memory is **unstructured markdown**. It is NOT key-value, NOT JSON, NOT structured data. The agent reads and writes free-form text. This is a deliberate design choice: the LLM is trusted to interpret and organize the content naturally.

**Daily note creation pattern:**
```python
if today_file.exists():
    content = existing + "\n" + content  # append
else:
    content = f"# {today_date()}\n\n" + content  # new day header
```

### 1.5 How Memory is Queried

Memory is NOT searched or queried with any retrieval mechanism. The entire `MEMORY.md` and today's notes are injected verbatim into the system prompt via `get_memory_context()`. This means:

- Memory size directly impacts token usage
- There is an implicit cap: very large memory files will bloat context
- No semantic search, no RAG, no summarization of old memories
- The LLM sees all memory every turn

### 1.6 How Memory is Updated

The agent updates memory through its **file tools** (read_file, write_file, edit_file). There is no dedicated "memory_write" tool. The system prompt tells the agent:

```
When remembering something, write to {workspace_path}/memory/MEMORY.md
```

The agent uses `write_file` or `edit_file` to modify memory files directly. This is elegant: memory is just files, and the agent already has file tools.

---

## 2. Skills System

**Source:** `nanobot/agent/skills.py`

### 2.1 Architecture Overview

Skills are markdown-based instruction packages that teach the agent how to perform specific tasks. Each skill is a directory containing a `SKILL.md` file with YAML frontmatter and markdown body. Skills are NOT code plugins -- they are prompt fragments injected into context.

### 2.2 Skill Discovery and Priority

```
workspace/skills/{name}/SKILL.md    # User workspace skills (highest priority)
nanobot/skills/{name}/SKILL.md       # Built-in skills (lower priority)
```

Workspace skills override built-in skills of the same name (checked by name collision in `list_skills`).

### 2.3 Key Class: `SkillsLoader`

```python
class SkillsLoader:
    def __init__(self, workspace: Path, builtin_skills_dir: Path | None = None):
        self.workspace = workspace
        self.workspace_skills = workspace / "skills"
        self.builtin_skills = builtin_skills_dir or BUILTIN_SKILLS_DIR
```

### 2.4 Core Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `list_skills(filter_unavailable=True)` | `(bool) -> list[dict]` | Enumerate all skills; returns `{name, path, source}` dicts |
| `load_skill(name)` | `(str) -> str\|None` | Read full SKILL.md content |
| `load_skills_for_context(names)` | `(list[str]) -> str` | Load multiple skills, strip frontmatter, format for prompt |
| `build_skills_summary()` | `() -> str` | Generate XML summary of all skills for progressive loading |
| `get_always_skills()` | `() -> list[str]` | Return skills with `always=true` metadata |
| `get_skill_metadata(name)` | `(str) -> dict\|None` | Parse YAML frontmatter |

### 2.5 SKILL.md File Format

Each SKILL.md has YAML frontmatter followed by markdown instructions:

```markdown
---
name: summarize
description: Summarize or extract text/transcripts from URLs...
homepage: https://summarize.sh
metadata: {"nanobot":{"emoji":"...","requires":{"bins":["summarize"]},"install":[...]}}
---

# Summarize

Instructions for the agent on how to use this skill...
```

**Frontmatter fields:**
- `name` -- Skill identifier
- `description` -- Human-readable description (used in summary)
- `homepage` -- Optional URL
- `metadata` -- JSON string containing nanobot-specific configuration:
  - `nanobot.emoji` -- Display emoji
  - `nanobot.requires.bins` -- Required CLI binaries (checked via `shutil.which`)
  - `nanobot.requires.env` -- Required environment variables
  - `nanobot.install` -- Installation instructions (brew/apt formulas)
  - `nanobot.always` -- If true, skill is always loaded into context

### 2.6 Progressive Loading Strategy (Critical Design Pattern)

This is one of the most important architectural decisions in nanobot. Skills are loaded in two tiers to avoid prompt bloat:

**Tier 1: Always-loaded skills** -- Skills marked with `always=true` have their full SKILL.md content injected into every system prompt. Used for foundational skills the agent needs every turn.

**Tier 2: Summary-only skills** -- All other skills appear only as an XML summary:

```xml
<skills>
  <skill available="true">
    <name>weather</name>
    <description>Check weather using wttr.in</description>
    <location>/path/to/SKILL.md</location>
  </skill>
  <skill available="false">
    <name>summarize</name>
    <description>Summarize URLs...</description>
    <location>/path/to/SKILL.md</location>
    <requires>CLI: summarize</requires>
  </skill>
</skills>
```

The system prompt instructs the agent:
> "To use a skill, read its SKILL.md file using the read_file tool."

This means the agent **lazy-loads skill instructions on demand** by using the `read_file` tool to fetch the full SKILL.md when needed. This keeps the base system prompt small while allowing unlimited skill expansion.

### 2.7 Requirement Checking

Before a skill is shown as available, its requirements are validated:

```python
def _check_requirements(self, skill_meta: dict) -> bool:
    requires = skill_meta.get("requires", {})
    for b in requires.get("bins", []):
        if not shutil.which(b):  # Check PATH for binary
            return False
    for env in requires.get("env", []):
        if not os.environ.get(env):  # Check env var exists
            return False
    return True
```

Skills with unmet requirements are still shown in the summary but marked `available="false"` with a `<requires>` tag explaining what's missing.

### 2.8 Bundled Skill Examples

| Skill | Description | Requirements | Always? |
|-------|-------------|-------------|---------|
| **weather** | Weather via wttr.in / Open-Meteo | None (uses curl) | No |
| **github** | GitHub CLI operations (PR, issues, API) | `gh` binary | No |
| **tmux** | Remote-control tmux sessions | `tmux` binary | No |
| **summarize** | URL/file/video summarization | `summarize` binary | No |
| **skill-creator** | Meta-skill for creating new skills | None | No |
| **cron** | Scheduling reminders/tasks | None (uses built-in tool) | No |

---

## 3. Tool Framework

### 3.1 Base Class: `Tool` (ABC)

**Source:** `nanobot/agent/tools/base.py`

```python
class Tool(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def description(self) -> str: ...

    @property
    @abstractmethod
    def parameters(self) -> dict[str, Any]: ...

    @abstractmethod
    async def execute(self, **kwargs: Any) -> str: ...
```

Every tool must implement four things:
1. **name** -- Unique identifier used in function calling (e.g., `"exec"`, `"read_file"`)
2. **description** -- Text description sent to the LLM
3. **parameters** -- JSON Schema dict defining input parameters
4. **execute** -- Async method that performs the action and returns a string

### 3.2 Tool Schema for LLM Function Calling

Tools are converted to OpenAI function-calling format via `to_schema()`:

```python
def to_schema(self) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }
    }
```

This output is directly compatible with OpenAI/Anthropic tool-use APIs.

### 3.3 Parameter Validation

The base class includes a built-in JSON Schema validator (`validate_params`):

```python
_TYPE_MAP = {
    "string": str, "integer": int, "number": (int, float),
    "boolean": bool, "array": list, "object": dict,
}
```

Validation checks:
- **Type checking** via `_TYPE_MAP`
- **Enum enforcement** -- value must be in allowed set
- **Numeric bounds** -- `minimum`/`maximum`
- **String length** -- `minLength`/`maxLength`
- **Required fields** -- missing required keys
- **Recursive validation** -- nested objects and arrays

Validation is called by the registry BEFORE tool execution:
```python
errors = tool.validate_params(params)
if errors:
    return f"Error: Invalid parameters for tool '{name}': " + "; ".join(errors)
```

### 3.4 Tool Registry

**Source:** `nanobot/agent/tools/registry.py`

```python
class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}  # name -> Tool instance
```

| Method | Description |
|--------|-------------|
| `register(tool)` | Add tool to registry by its `.name` |
| `unregister(name)` | Remove tool by name |
| `get(name)` | Lookup tool by name |
| `has(name)` | Check existence |
| `get_definitions()` | Return all tools as OpenAI-format schemas |
| `execute(name, params)` | Validate params, then call `tool.execute(**params)` |

**Error handling in execute:**
```python
async def execute(self, name: str, params: dict) -> str:
    tool = self._tools.get(name)
    if not tool:
        return f"Error: Tool '{name}' not found"
    try:
        errors = tool.validate_params(params)
        if errors:
            return f"Error: Invalid parameters..."
        return await tool.execute(**params)
    except Exception as e:
        return f"Error executing {name}: {str(e)}"
```

All errors are caught and returned as string messages -- tools NEVER raise exceptions to the caller. This ensures the LLM always gets a response it can reason about.

---

## 4. Built-in Tools

### 4.1 Shell Execution (`exec`)

**Source:** `nanobot/agent/tools/shell.py`

```python
class ExecTool(Tool):
    name = "exec"
    parameters = {
        "command": str (required),
        "working_dir": str (optional)
    }
```

**Safety guards (`_guard_command`):**
- **Deny patterns** (regex blocklist): `rm -rf`, `del /f`, `format`/`mkfs`, `dd if=`, `shutdown`/`reboot`, fork bombs
- **Allow patterns** (optional whitelist): if set, only matching commands pass
- **Workspace restriction**: blocks `../` path traversal and absolute paths outside workspace

**Execution model:**
- Uses `asyncio.create_subprocess_shell()` -- runs via system shell
- Configurable timeout (default 60s); kills process on timeout
- Captures both stdout and stderr separately
- Output truncated to 10,000 characters
- Returns exit code on non-zero

### 4.2 File System Tools

**Source:** `nanobot/agent/tools/filesystem.py`

Four tools sharing a common `_resolve_path()` helper that enforces directory restrictions:

| Tool | Name | Parameters | Behavior |
|------|------|-----------|----------|
| `ReadFileTool` | `read_file` | `path` (required) | Read file as UTF-8 text |
| `WriteFileTool` | `write_file` | `path`, `content` (required) | Write file, create parent dirs |
| `EditFileTool` | `edit_file` | `path`, `old_text`, `new_text` (required) | Find-and-replace; fails if old_text not found or ambiguous (>1 match) |
| `ListDirTool` | `list_dir` | `path` (required) | List directory contents with file/folder icons |

**Path security:** All tools accept an `allowed_dir` parameter. If set, `_resolve_path()` checks that the resolved absolute path starts with the allowed directory, preventing path traversal.

**Edit safety:** `EditFileTool` rejects edits where `old_text` appears more than once, forcing the agent to provide more context for unique matching.

### 4.3 Web Tools

**Source:** `nanobot/agent/tools/web.py`

**WebSearchTool (`web_search`):**
- Uses Brave Search API
- Requires `BRAVE_API_KEY` env var
- Returns up to 10 results with title, URL, description
- Parameters: `query` (required), `count` (optional, 1-10)

**WebFetchTool (`web_fetch`):**
- Fetches any URL via httpx with `follow_redirects=True`
- URL validation: must be http/https with valid domain
- Content extraction modes:
  - HTML: uses `readability` library, then converts to markdown or strips tags
  - JSON: pretty-prints with `json.dumps(indent=2)`
  - Other: returns raw text
- Output truncated to 50,000 characters (configurable)
- Returns JSON envelope: `{url, finalUrl, status, extractor, truncated, length, text}`

### 4.4 Message Tool (`message`)

**Source:** `nanobot/agent/tools/message.py`

```python
class MessageTool(Tool):
    name = "message"
    parameters = {
        "content": str (required),
        "channel": str (optional),
        "chat_id": str (optional)
    }
```

Sends messages to users via the event bus. The tool holds a `send_callback` (async function) that publishes `OutboundMessage` events. Context (channel/chat_id) is set per-message by the agent loop, so the agent can reply to the correct channel without specifying it.

### 4.5 Spawn Tool (`spawn`)

**Source:** `nanobot/agent/tools/spawn.py`

```python
class SpawnTool(Tool):
    name = "spawn"
    parameters = {
        "task": str (required),
        "label": str (optional)
    }
```

Delegates to `SubagentManager.spawn()`. Creates background agent instances for long-running tasks. The subagent runs asynchronously and announces results back through the message bus.

### 4.6 Cron Tool (`cron`)

**Source:** `nanobot/agent/tools/cron.py`

```python
class CronTool(Tool):
    name = "cron"
    parameters = {
        "action": enum["add", "list", "remove"] (required),
        "message": str,
        "every_seconds": int,
        "cron_expr": str,
        "job_id": str
    }
```

Schedules recurring tasks and reminders. Supports both interval-based (`every_seconds`) and cron-expression scheduling. Jobs can be reminders (message delivered to user) or tasks (agent executes and reports).

---

## 5. Context Assembly Pipeline

**Source:** `nanobot/agent/context.py`

### 5.1 Class: `ContextBuilder`

The context builder is the orchestrator that assembles the complete system prompt from multiple sources:

```python
class ContextBuilder:
    BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"]

    def __init__(self, workspace: Path):
        self.workspace = workspace
        self.memory = MemoryStore(workspace)
        self.skills = SkillsLoader(workspace)
```

### 5.2 System Prompt Assembly Order

`build_system_prompt()` assembles the prompt in this order:

```
1. Core Identity (hardcoded agent description + runtime info)
2. Bootstrap Files (AGENTS.md, SOUL.md, USER.md, TOOLS.md, IDENTITY.md)
3. Memory Context (MEMORY.md + today's daily notes)
4. Always-loaded Skills (full content of skills with always=true)
5. Skills Summary (XML listing of all other available skills)
```

Each section is joined by `\n\n---\n\n` separators.

### 5.3 Bootstrap Files

These are optional workspace-level markdown files that customize the agent's behavior:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Multi-agent coordination rules |
| `SOUL.md` | Personality and behavioral guidelines |
| `USER.md` | User-specific preferences and context |
| `TOOLS.md` | Custom tool usage instructions |
| `IDENTITY.md` | Identity overrides |

These are loaded from the workspace root if they exist, enabling per-project customization without modifying code.

### 5.4 Message Building

`build_messages()` constructs the full message array for the LLM:

```python
def build_messages(self, history, current_message, media=None, channel=None, chat_id=None):
    messages = []
    messages.append({"role": "system", "content": system_prompt})
    messages.extend(history)  # Previous conversation turns
    messages.append({"role": "user", "content": user_content})
    return messages
```

**Image support:** If `media` paths are provided, images are base64-encoded and sent as multimodal content:
```python
[
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
    {"type": "text", "text": "user message"}
]
```

### 5.5 Tool Result Integration

Tool results are appended to the message array in OpenAI's tool-call format:

```python
{"role": "tool", "tool_call_id": "...", "name": "read_file", "content": "file contents..."}
```

The agent loop iterates: LLM call -> tool calls -> tool results -> LLM call -> ... until the LLM responds without tool calls (max 20 iterations).

---

## 6. Subagent System

**Source:** `nanobot/agent/subagent.py`

### 6.1 Architecture

Subagents are lightweight, isolated agent instances that run in the background via `asyncio.Task`. They share the same LLM provider but have:

- **Isolated context** -- fresh system prompt, no conversation history
- **Reduced tool set** -- no `message` tool, no `spawn` tool (cannot message users or spawn further subagents)
- **Focused prompt** -- task-specific system prompt with strict rules
- **Limited iterations** -- max 15 tool-call rounds (vs 20 for main agent)

### 6.2 Subagent Tool Set

| Tool | Available? |
|------|-----------|
| `read_file` | Yes |
| `write_file` | Yes |
| `list_dir` | Yes |
| `exec` | Yes |
| `web_search` | Yes |
| `web_fetch` | Yes |
| `message` | **No** |
| `spawn` | **No** |
| `cron` | **No** |

### 6.3 Result Announcement

When a subagent completes, it publishes an `InboundMessage` back to the message bus with:
- `channel="system"`, `sender_id="subagent"`
- `chat_id` = `"original_channel:original_chat_id"` (routing info)
- Content includes the task description, result, and instruction to "summarize naturally"

The main agent loop handles `channel="system"` messages specially, parsing the routing info and relaying the summarized result to the original user.

---

## 7. Integration Map

### 7.1 Data Flow: Message Processing

```
User Message
    |
    v
MessageBus.consume_inbound()
    |
    v
AgentLoop._process_message()
    |
    +---> SessionManager.get_or_create()    # Load conversation history
    +---> ContextBuilder.build_messages()    # Assemble full prompt
    |         |
    |         +---> MemoryStore.get_memory_context()   # Read MEMORY.md + today
    |         +---> SkillsLoader.get_always_skills()   # Full content of always-skills
    |         +---> SkillsLoader.build_skills_summary() # XML summary of other skills
    |         +---> _load_bootstrap_files()              # SOUL.md, USER.md, etc.
    |
    +---> LLM Provider.chat()               # Send to LLM with tool definitions
    |         |
    |         +---> ToolRegistry.get_definitions()  # OpenAI-format schemas
    |
    +---> (loop) ToolRegistry.execute()     # Execute tool calls
    |         |
    |         +---> Tool.validate_params()   # Schema validation
    |         +---> Tool.execute()            # Actual execution
    |
    +---> SessionManager.save()              # Persist conversation
    |
    v
MessageBus.publish_outbound()
```

### 7.2 How Skills Reach the Agent

```
Filesystem Discovery              Prompt Injection
    |                                 |
    v                                 v
skills/{name}/SKILL.md   --->   Always Skills: Full markdown in system prompt
                                Other Skills: XML summary only
                                    |
                                    v
                           Agent uses read_file tool
                                    |
                                    v
                           Full SKILL.md loaded on demand
```

### 7.3 How Memory Flows

```
Agent Loop
    |
    +--> ContextBuilder.build_system_prompt()
    |        |
    |        +--> MemoryStore.get_memory_context()
    |                 |
    |                 +--> read_long_term()  -->  memory/MEMORY.md
    |                 +--> read_today()      -->  memory/2025-01-15.md
    |
    +--> Agent decides to remember something
    |        |
    |        +--> Uses write_file / edit_file tool
    |                 |
    |                 +--> Writes to memory/MEMORY.md
    |
    (next turn: updated memory appears in system prompt)
```

---

## 8. Design Patterns and Takeaways

### 8.1 Pattern: Files as Memory

Memory is stored as plain markdown files. No database, no vector store. The agent reads and writes memory through its own file tools. This creates an elegant feedback loop where memory is both readable by humans and editable by the agent using the same tools it uses for everything else.

**Trade-off:** No semantic search. Memory must fit in context window. Works well for personal assistants with modest memory needs; would not scale to large knowledge bases.

### 8.2 Pattern: Progressive Skill Loading

Skills are discovered from the filesystem but only summaries are injected into the system prompt. The agent reads full skill content on demand using `read_file`. This keeps the base prompt size bounded regardless of how many skills are installed.

**Trade-off:** Requires an extra LLM turn (tool call to read_file) the first time a skill is used. But this is far cheaper than injecting all skill content into every prompt.

### 8.3 Pattern: Tools as the Universal Interface

Everything the agent does goes through the tool framework. There are no special-case APIs:
- Memory writes = `write_file` tool
- Skill loading = `read_file` tool
- Shell commands = `exec` tool
- Subagent spawning = `spawn` tool

This uniformity means the LLM only needs to learn one interaction pattern: call tools with JSON parameters, get string results.

### 8.4 Pattern: Error Strings, Not Exceptions

The tool registry catches all exceptions and returns error strings. The LLM never sees a stack trace or exception type -- just a human-readable error message. This lets the LLM reason about errors and retry or adjust its approach.

### 8.5 Pattern: Safety by Layering

Security is implemented at multiple levels:
1. **Tool-level:** ExecTool has regex deny patterns, EditFileTool requires unique match
2. **Path-level:** `_resolve_path()` enforces allowed directories
3. **Subagent-level:** Subagents have reduced tool sets (no message, no spawn)
4. **Schema-level:** JSON Schema validation before execution

### 8.6 Pattern: Bootstrap Files for Customization

Per-workspace markdown files (SOUL.md, USER.md, etc.) allow behavior customization without code changes. This is the same pattern used by Claude Code's CLAUDE.md and Cursor's .cursorrules.

### 8.7 Pattern: Subagent Isolation

Subagents are sandboxed: no user messaging, no spawning, limited iterations. Results flow back through the message bus as system messages, which the main agent then summarizes for the user. This prevents subagents from going rogue while still allowing complex background work.

### 8.8 What Nanobot Does NOT Have

Compared to frameworks like LangChain or CrewAI, nanobot deliberately omits:
- **Vector stores / RAG** -- memory is raw text in context
- **Chain-of-thought frameworks** -- the LLM handles its own reasoning
- **Structured output parsing** -- tool results are plain strings
- **Retry/backoff logic** -- errors go to the LLM to handle
- **Dependency injection** -- tools are manually registered
- **Plugin marketplace** -- skills are local directories

This minimalism is a feature: the entire tool framework is ~600 lines of Python. The entire memory system is ~90 lines. The entire skills loader is ~180 lines.
