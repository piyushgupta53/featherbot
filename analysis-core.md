# Nanobot Architecture Analysis - Core Agent Systems

**Repository**: https://github.com/HKUDS/nanobot
**Version analyzed**: 0.1.3.post4
**Date**: 2026-02-06

---

## Table of Contents

1. [Repository Overview](#1-repository-overview)
2. [Entry Points and CLI](#2-entry-points-and-cli)
3. [Agent Loop (agent/loop.py)](#3-agent-loop)
4. [Context Builder (agent/context.py)](#4-context-builder)
5. [Sub-Agent System (agent/subagent.py)](#5-sub-agent-system)
6. [Tool System](#6-tool-system)
7. [Message Bus](#7-message-bus)
8. [Session Management](#8-session-management)
9. [Memory System](#9-memory-system)
10. [Skills Framework](#10-skills-framework)
11. [LLM Provider Abstraction](#11-llm-provider-abstraction)
12. [Configuration System](#12-configuration-system)
13. [Channels Architecture](#13-channels-architecture)
14. [Cron and Heartbeat Services](#14-cron-and-heartbeat-services)
15. [Design Decisions and Tradeoffs](#15-design-decisions-and-tradeoffs)
16. [Comparison with Claude Code](#16-comparison-with-claude-code)

---

## 1. Repository Overview

Nanobot is an ultra-lightweight personal AI assistant framework with approximately 3,400 lines of core agent code. It positions itself as "99% smaller than Claude Code's 430k+ lines."

### File Tree

```
nanobot/
├── bridge/                          # Node.js integrations (WhatsApp, Discord)
├── case/                            # Example use cases
├── nanobot/                         # Core Python package
│   ├── agent/                       # Agent core
│   │   ├── loop.py                  # ReAct agent loop
│   │   ├── context.py               # Prompt/context builder
│   │   ├── memory.py                # Persistent memory store
│   │   ├── skills.py                # Skill loading framework
│   │   ├── subagent.py              # Background sub-agent spawning
│   │   └── tools/                   # Built-in tool implementations
│   │       ├── __init__.py          # Exports Tool, ToolRegistry
│   │       ├── base.py              # Abstract Tool base class
│   │       ├── registry.py          # Tool registration and dispatch
│   │       ├── filesystem.py        # read_file, write_file, edit_file, list_dir
│   │       ├── shell.py             # Shell command execution
│   │       ├── web.py               # Web search (Brave) and fetch
│   │       ├── message.py           # Send messages to chat channels
│   │       ├── spawn.py             # Spawn sub-agents
│   │       └── cron.py              # Schedule cron jobs
│   ├── skills/                      # Pre-built skill definitions (SKILL.md files)
│   ├── channels/                    # Chat channel plugins
│   │   ├── base.py                  # BaseChannel abstract class
│   │   └── manager.py              # ChannelManager coordinator
│   ├── bus/                         # Async message routing
│   │   ├── events.py               # InboundMessage, OutboundMessage dataclasses
│   │   └── queue.py                # MessageBus with asyncio queues
│   ├── cron/                        # Scheduled task system
│   │   ├── service.py              # CronService with async timer management
│   │   └── types.py                # CronJob, CronSchedule data types
│   ├── heartbeat/                   # Proactive agent wake-ups
│   │   └── service.py              # HeartbeatService (checks HEARTBEAT.md)
│   ├── providers/                   # LLM backend abstraction
│   │   ├── base.py                 # LLMProvider ABC, LLMResponse, ToolCallRequest
│   │   └── litellm_provider.py     # LiteLLM-based multi-provider implementation
│   ├── session/                     # Conversation persistence
│   │   └── manager.py              # SessionManager + Session (JSONL storage)
│   ├── config/                      # Configuration management
│   │   ├── schema.py               # Pydantic Config model
│   │   └── loader.py               # JSON loader with migrations
│   └── cli/                         # Command-line interface
│       └── commands.py             # Typer CLI app
├── tests/                           # Test suite
├── workspace/                       # Default agent working directory
├── pyproject.toml                   # Package config (Hatchling build)
├── Dockerfile                       # Container support
└── LICENSE                          # MIT
```

### Tech Stack

- **Language**: Python 3.11+
- **CLI Framework**: Typer + Rich
- **LLM Abstraction**: LiteLLM (supports OpenRouter, Anthropic, OpenAI, DeepSeek, Groq, Gemini, Zhipu, Moonshot, vLLM)
- **Async**: Pure asyncio throughout
- **Config**: Pydantic v2 with JSON file storage
- **Logging**: Loguru
- **Scheduling**: croniter
- **Web Parsing**: readability-lxml
- **Build System**: Hatchling

---

## 2. Entry Points and CLI

**File**: `nanobot/cli/commands.py`
**Entry point** (from pyproject.toml): `nanobot = "nanobot.cli.commands:app"`

### CLI Commands

| Command | Purpose |
|---------|---------|
| `nanobot onboard` | Initialize config and workspace with template files |
| `nanobot gateway` | Start full server with channels, bus, agent loop, cron, heartbeat |
| `nanobot agent` | Direct agent interaction (single-message or interactive REPL) |
| `nanobot status` | Display system configuration and API key status |
| `nanobot channels login` | Set up channel integrations |
| `nanobot channels status` | Check channel connection status |
| `nanobot cron list/add/remove/enable/run` | Manage scheduled tasks |

### Gateway Startup Flow

The `gateway` command orchestrates the entire system:

```
1. Load configuration (config.json)
2. Initialize MessageBus (asyncio queues)
3. Initialize LLM provider (LiteLLMProvider)
4. Initialize SessionManager
5. Initialize AgentLoop (connects to bus, provider, sessions)
6. Initialize ChannelManager (Telegram, Discord, WhatsApp, Feishu)
7. Initialize CronService (scheduled tasks)
8. Initialize HeartbeatService (periodic wake-ups)
9. Start all services concurrently via asyncio.gather()
```

### Agent Command (Direct Mode)

The `agent` command provides two modes:
- **Single-message**: `nanobot agent "What is the weather?"`
- **Interactive**: `nanobot agent` (enters REPL loop)

Both modes create a minimal pipeline: provider + context builder + agent loop, without the full bus/channel infrastructure.

### Design Notes

- The gateway mode is designed for "headless" deployment behind messaging channels
- The agent mode is designed for local CLI usage
- Bridge builder automatically downloads and builds Node.js integration code for WhatsApp/Discord
- Configuration validation checks for required API keys before operation

---

## 3. Agent Loop

**File**: `nanobot/agent/loop.py`
**Class**: `AgentLoop`

This is the heart of nanobot -- the ReAct (Reasoning + Acting) loop that processes messages through LLM inference and tool execution.

### Architecture

```
          InboundMessage
               │
               v
        ┌──────────────┐
        │  AgentLoop    │
        │  ._process_   │
        │   message()   │
        └──────┬───────┘
               │
    ┌──────────┴──────────┐
    v                     v
ContextBuilder        ToolRegistry
    │                     │
    v                     v
build_messages()     execute(tool, params)
    │                     │
    v                     │
LLMProvider.chat()        │
    │                     │
    v                     │
LLMResponse ──────────────┘
    │         (if has_tool_calls)
    v
OutboundMessage
    │
    v
MessageBus.publish_outbound()
```

### Core Loop Logic (ReAct Pattern)

The processing follows a classic ReAct loop with bounded iterations:

```
function _process_message(inbound):
    session = session_manager.get_or_create(session_key)
    context = context_builder.build_messages(session, inbound)

    for iteration in range(max_iterations):          # default: 20
        response = llm_provider.chat(
            messages=context,
            tools=tool_registry.get_definitions(),
            model=config.agent.model,
            max_tokens=config.agent.max_tokens,       # default: 8192
            temperature=config.agent.temperature       # default: 0.7
        )

        if response.has_tool_calls:
            for tool_call in response.tool_calls:
                result = tool_registry.execute(
                    tool_call.name,
                    tool_call.arguments
                )
                context.add_tool_result(tool_call.id, result)
            context.add_assistant_message(response)
            continue                                    # next iteration

        if response.content:
            publish_outbound(response.content)
            session.add_message("assistant", response.content)
            break                                       # done

    # If max_iterations reached, send whatever was last generated
```

### Key Behaviors

1. **Max iterations**: Default 20 (configurable in `config.agent`). This is the hard ceiling on tool-use loops per single user message.

2. **Stopping conditions**:
   - LLM returns content with NO tool calls -> loop ends, response sent
   - Max iterations reached -> loop ends, last content sent
   - Error in LLM call -> error message sent as response

3. **Tool execution is synchronous within the loop**: Each tool call is awaited, its result appended to context, then the next LLM call is made. Multiple tool calls in a single LLM response are executed sequentially (not in parallel).

4. **History management**: The session stores full message history. The ContextBuilder handles truncation/windowing when building messages for the LLM call.

### Two Message Pathways

1. **Standard messages** (`_process_message`): Full ReAct loop with user input, tool execution, and response generation.

2. **System messages** (`_process_system_message`): Handles background results from sub-agents. These arrive as system-type InboundMessages and are processed with a lighter context (the agent is told to "summarize this naturally for the user").

### Registered Default Tools

The AgentLoop registers these tools at initialization:

| Tool | Class | Capability |
|------|-------|------------|
| `read_file` | ReadFileTool | Read file contents |
| `write_file` | WriteFileTool | Create/overwrite files |
| `edit_file` | EditFileTool | Find-and-replace in files |
| `list_dir` | ListDirTool | List directory contents |
| `exec` | ExecTool | Execute shell commands |
| `web_search` | WebSearchTool | Brave API search |
| `web_fetch` | WebFetchTool | Fetch and parse web pages |
| `message` | MessageTool | Send messages to chat channels |
| `spawn` | SpawnTool | Launch background sub-agents |
| `cron_*` | CronTool | Schedule/manage cron jobs (when enabled) |

### Workspace Restriction

When `config.tools.restrict_to_workspace` is enabled:
- File tools (read, write, edit, list) are sandboxed to the workspace directory
- Shell tool prevents path traversal outside workspace
- Path resolution validates all paths stay within bounds

### Error Handling

- LLM call failures are caught and returned as error messages to the user
- Tool execution errors are caught by the ToolRegistry and returned as error strings (not exceptions) to the LLM, allowing it to recover
- The loop never crashes -- all errors are gracefully degraded into messages

---

## 4. Context Builder

**File**: `nanobot/agent/context.py`
**Class**: `ContextBuilder`

### Responsibility

Assembles the complete prompt (system prompt + conversation history + current input) for each LLM call. This is the "prompt engineering" layer.

### System Prompt Assembly

The system prompt is built by concatenating several sections:

```
1. Identity Section
   - Current datetime, OS, Python version
   - Workspace path
   - Agent name/identity

2. Bootstrap Files (loaded from workspace)
   - AGENTS.md    -- Agent behavior instructions
   - SOUL.md      -- Personality/tone directives
   - USER.md      -- User preferences/context
   - TOOLS.md     -- Custom tool usage instructions
   - IDENTITY.md  -- Agent identity overrides

3. Memory Context
   - Long-term memory (MEMORY.md)
   - Today's daily memory
   (via MemoryStore.get_memory_context())

4. Skills Context
   - Always-loaded skills: full content embedded
   - Optional skills: summary only (name + description)
   (via SkillsLoader.load_skills_for_context())
```

### Message Construction

`build_messages()` produces the final message array:

```python
[
    {"role": "system", "content": system_prompt},
    # ... conversation history from session ...
    {"role": "user", "content": current_input}
]
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `build_system_prompt()` | Assemble complete system context |
| `build_messages()` | Full message list for LLM call |
| `_build_user_content()` | Handle text + optional base64-encoded image attachments |
| `add_tool_result()` | Append tool execution result to message chain |
| `add_assistant_message()` | Append LLM response (with tool calls) to chain |

### Progressive Skill Loading

A notable design pattern: skills marked with `always: true` in their YAML frontmatter have their full content embedded in every system prompt. Other skills show only a summary (name + description), and the agent must explicitly read the skill file if it wants the full content. This balances context window efficiency against capability discovery.

### Conversation History

History comes from the Session object, which defaults to the **last 50 messages**. There is no token-counting-based truncation -- it is a simple message count window.

### Design Notes

- No explicit token budget management. The system relies on the LLM provider's max_tokens setting and the 50-message history window.
- Bootstrap files are optional -- missing files are silently skipped.
- Media attachments (images) are base64-encoded and included as multimodal content in the user message.

---

## 5. Sub-Agent System

**File**: `nanobot/agent/subagent.py`
**Class**: `SubagentManager`

### Architecture

Sub-agents are **asyncio tasks** (not separate processes or threads). They share the same event loop and LLM provider instance but operate with independent context windows.

```
Main Agent Loop
    │
    ├── spawn("research weather in NYC")
    │       │
    │       v
    │   asyncio.create_task(
    │       _run_subagent(task_id, task_description)
    │   )
    │       │
    │       │  (runs concurrently on same event loop)
    │       │
    │       v
    │   Subagent mini-loop:
    │     - Build focused prompt
    │     - LLM call with subset of tools
    │     - Execute tools (up to 15 iterations)
    │     - Return result
    │       │
    │       v
    │   Announce result via MessageBus
    │   (as system message)
    │
    └── (main loop continues processing other messages)
```

### Spawning Mechanism

1. The main agent calls the `spawn` tool with a task description and optional label.
2. `SubagentManager.spawn()` creates an asyncio task with a unique ID (truncated UUID).
3. The task runs `_run_subagent()`, which is a self-contained mini ReAct loop.
4. On completion, results are published back through the MessageBus as system messages.
5. The main agent receives and "summarizes naturally for the user."

### Sub-Agent Constraints

Sub-agents have **restricted capabilities** compared to the main agent:

| Capability | Main Agent | Sub-Agent |
|-----------|------------|-----------|
| File read/write/edit | Yes | Yes |
| Shell execution | Yes | Yes |
| Web search/fetch | Yes | Yes |
| Send messages to user | Yes | **No** |
| Spawn more sub-agents | Yes | **No** |
| Cron management | Yes | **No** |
| Max iterations | 20 | **15** |

The restriction on spawning prevents runaway recursive agent proliferation.

### Sub-Agent Prompt

The prompt emphasizes focus:
> "Stay focused - complete only the assigned task, nothing else."

Sub-agents receive:
- The task description
- Current datetime and workspace info
- A minimal system prompt (no skills, no memory, no bootstrap files)

### Result Announcement

Results are framed as system messages to avoid exposing internal agent mechanics:
- Success: the result content is announced
- Failure: a status indicator with error information is announced
- The main agent is instructed to "summarize this naturally for the user"

### Error Handling

- Exceptions during sub-agent execution are caught, logged, and announced as failures
- The main agent loop is never disrupted by sub-agent errors
- Sub-agent tasks are fire-and-forget from the main loop's perspective

### Design Tradeoffs

**Pros**:
- Lightweight (no process/thread overhead)
- Shared LLM connection (no extra auth/setup)
- Clean isolation via separate context windows

**Cons**:
- Single-threaded (shares CPU with main loop via async)
- No true parallelism for CPU-bound operations
- Shared rate limits with main agent's LLM calls
- No cancellation mechanism visible in the code

---

## 6. Tool System

### Tool Base Class (`agent/tools/base.py`)

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

    def validate_params(self, params) -> list[str]: ...
    def to_schema(self) -> dict[str, Any]: ...  # OpenAI function format
```

Key design decisions:
- All tools return **strings** (not structured data). This simplifies the interface but loses type safety.
- Parameter validation uses a custom JSON Schema validator built into the base class, supporting type checking, enums, min/max, required fields, and nested objects/arrays.
- `to_schema()` converts to OpenAI function calling format, which LiteLLM uses as the common denominator.

### Tool Registry (`agent/tools/registry.py`)

```python
class ToolRegistry:
    def register(tool: Tool): ...
    def unregister(name: str): ...
    def get(name: str) -> Tool | None: ...
    def execute(name: str, params: dict) -> str: ...  # async
    def get_definitions() -> list[dict]: ...  # OpenAI schemas
```

The `execute()` method is the critical path:
1. Look up tool by name
2. Validate parameters against schema
3. Call `tool.execute(**params)`
4. Catch ALL exceptions and return error as string
5. Never raise -- always returns a string result

This "never crash" pattern means the LLM always gets feedback, even on errors, and can attempt recovery.

### Individual Tools

#### Filesystem Tools (`agent/tools/filesystem.py`)

Four tools: `read_file`, `write_file`, `edit_file`, `list_dir`

- **Path resolution**: `_resolve_path()` sanitizes paths and enforces workspace restrictions
- **read_file**: Validates file exists and is not a directory
- **write_file**: Auto-creates parent directories (`mkdir(parents=True, exist_ok=True)`)
- **edit_file**: Find-and-replace with safeguard -- warns if search text matches multiple times, requires exact single match
- **list_dir**: Returns sorted listing with folder/file emoji indicators

All tools catch `PermissionError`, `FileNotFoundError`, and generic exceptions, returning descriptive error strings.

#### Shell Tool (`agent/tools/shell.py`)

**Class**: `ExecTool`

- Uses `asyncio.create_subprocess_shell` for async execution
- **Default timeout**: 60 seconds (configurable)
- **Output limit**: 10,000 characters with truncation warning
- **Deny patterns**: Regex-based blocklist for dangerous commands (`rm -rf /`, `mkfs`, `shutdown`, fork bombs, etc.)
- **Allow patterns**: Optional whitelist mode
- **Workspace restriction**: Prevents path traversal in commands when enabled
- Captures stdout and stderr separately, includes exit code in output
- On timeout: kills the process and returns timeout error message

#### Web Tools (`agent/tools/web.py`)

**WebSearchTool**:
- Uses Brave Search API
- Requires `BRAVE_API_KEY` environment variable
- Returns 1-10 results with title, URL, snippet
- Default: 5 results

**WebFetchTool**:
- HTTP/HTTPS validation
- 30-second timeout, max 5 redirects
- Content-type aware processing:
  - JSON: formatted with indentation
  - HTML: processed through readability-lxml, converted to markdown
  - Other: returned raw
- 50,000 character output limit
- Returns structured JSON with metadata (final URL, status, extraction method, truncation flag)

#### Message Tool (`agent/tools/message.py`)

- Sends outbound messages via callback function
- Context-aware: tracks current channel and chat_id
- Creates `OutboundMessage` objects routed through the bus
- Defaults to current conversation context

#### Spawn Tool (`agent/tools/spawn.py`)

- Thin wrapper around `SubagentManager.spawn()`
- Passes task description and optional label
- Maintains context (channel, chat_id) for result announcements

---

## 7. Message Bus

**Files**: `nanobot/bus/events.py`, `nanobot/bus/queue.py`

### Event Types

```python
@dataclass
class InboundMessage:
    channel: str          # "telegram", "discord", "whatsapp", etc.
    sender_id: str
    chat_id: str
    content: str
    timestamp: float
    media_urls: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    @property
    def session_key(self) -> str:
        return f"{self.channel}:{self.chat_id}"

@dataclass
class OutboundMessage:
    channel: str
    chat_id: str
    content: str
    reply_to: str | None = None
    media: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
```

### MessageBus

The bus uses two `asyncio.Queue` instances:
- **Inbound queue**: channel -> agent
- **Outbound queue**: agent -> channel

Key methods:
- `publish_inbound()` / `consume_inbound()`: Agent-bound messages
- `publish_outbound()` / `consume_outbound()`: Response distribution
- `subscribe_outbound(channel, callback)`: Register channel-specific delivery callbacks
- `dispatch_outbound()`: Background task polling outbound queue with 1-second timeout intervals

The dispatcher invokes all registered callbacks for the target channel, with per-callback error handling to prevent one failure from blocking others.

### Design Notes

- Pure async, no threading or multiprocessing
- Decouples channels from agent completely -- channels don't know about the agent loop
- Simple queue-based design (not a full event system)
- `_running` flag enables graceful shutdown

---

## 8. Session Management

**File**: `nanobot/session/manager.py`
**Classes**: `Session`, `SessionManager`

### Session

Stores conversation state for a single chat:
- `key`: Unique identifier (format: `"channel:chat_id"`)
- `messages`: List of message dicts `{"role": "...", "content": "...", "timestamp": ...}`
- `created_at`, `updated_at`: Datetime tracking
- `metadata`: Arbitrary key-value storage

Key behaviors:
- `add_message()`: Appends with timestamp
- `get_history(limit=50)`: Returns last N messages (default 50)
- `clear()`: Resets conversation

### SessionManager

Persistent storage using JSONL files in `~/.nanobot/sessions/`:
- First line: metadata (`{"_type": "metadata", ...}`)
- Subsequent lines: individual messages as JSON
- Filename sanitization via `safe_filename()`
- In-memory cache to reduce disk I/O

Key methods:
- `get_or_create(key)`: Cache-first, then disk, then new
- `save(session)`: Write metadata + messages as JSONL
- `list_sessions()`: Scan directory, sorted by recency
- `delete(key)`: Remove from cache and disk

### History Windowing

The critical detail: **history is limited by message count (default 50), not by token count**. This is a significant simplification compared to systems like Claude Code which use token-aware context management. The tradeoff is simplicity vs. potential context overflow with long messages.

---

## 9. Memory System

**File**: `nanobot/agent/memory.py`
**Class**: `MemoryStore`

### Two-Tier Architecture

1. **Daily Memory**: Files at `memory/YYYY-MM-DD.md`
   - Automatically dated headers
   - Append-only within a day
   - `get_recent_memories(days)` retrieves last N days

2. **Long-term Memory**: Single `MEMORY.md` file
   - Persistent across sessions
   - Read/write (not append-only)
   - Intended for important, durable knowledge

### Context Generation

`get_memory_context()` produces a formatted string combining:
- Long-term memory content
- Today's daily memory

This is injected into the system prompt by the ContextBuilder.

### Design Notes

- File-based storage (no database)
- UTF-8 encoding throughout
- Auto-creates directory structure
- No memory size limits or cleanup mechanisms visible in the code
- The agent is expected to self-manage its memory content

---

## 10. Skills Framework

**File**: `nanobot/agent/skills.py`
**Class**: `SkillsLoader`

### Skill Format

Skills are Markdown files (`SKILL.md`) with YAML frontmatter:

```markdown
---
description: "What this skill does"
requirements:
  commands: ["git", "node"]
  env: ["GITHUB_TOKEN"]
nanobot:
  always: true    # Load into every prompt
---

# Skill Name

Instructions and content...
```

### Discovery and Loading

Two skill sources (workspace skills take priority):
1. Workspace skills: `{workspace}/skills/*/SKILL.md`
2. Built-in skills: `{package}/skills/*/SKILL.md`

### Requirement Validation

Skills can declare dependencies:
- **commands**: Validated via `shutil.which()` (checks PATH)
- **env**: Validated via `os.environ.get()` (checks environment variables)
- Skills with unmet requirements are flagged as unavailable

### Progressive Loading Strategy

```
Always-loaded skills:
  -> Full content embedded in system prompt

Optional skills:
  -> Summary only in system prompt (name + description)
  -> Agent reads full SKILL.md file when needed via read_file tool
```

This is an important context window optimization. By default, only summaries are shown, and the agent can "pull in" full skill definitions on demand.

### Output Format

`build_skills_summary()` produces XML-formatted output:

```xml
<skills>
  <skill name="github" location="/path/to/SKILL.md" available="true">
    Description of the GitHub skill
  </skill>
  ...
</skills>
```

---

## 11. LLM Provider Abstraction

**Files**: `nanobot/providers/base.py`, `nanobot/providers/litellm_provider.py`

### Base Interface

```python
@dataclass
class ToolCallRequest:
    id: str
    name: str
    arguments: dict[str, Any]

@dataclass
class LLMResponse:
    content: str | None
    tool_calls: list[ToolCallRequest]
    finish_reason: str | None
    usage: dict | None

    @property
    def has_tool_calls(self) -> bool: ...

class LLMProvider(ABC):
    async def chat(
        messages: list[dict],
        tools: list[dict] | None,
        model: str | None,
        max_tokens: int | None,
        temperature: float | None
    ) -> LLMResponse: ...

    def get_default_model(self) -> str: ...
```

### LiteLLM Implementation

The `LiteLLMProvider` wraps the LiteLLM library, which provides a unified API across providers:

**Supported providers** (detected by API key prefix/endpoint):
- OpenRouter
- Anthropic
- OpenAI
- Gemini
- DeepSeek
- Zhipu (GLM models)
- Groq
- Moonshot (Kimi)
- vLLM (local models)

**Key behaviors**:
- **Auto-detection**: Provider identified from API key format
- **Model prefixing**: Automatically adds provider-specific prefixes (e.g., `"openrouter/"` for OpenRouter, `"zai/"` for Zhipu)
- **Temperature overrides**: Special handling for models that require specific temperature values (e.g., Kimi K2.5 forces temperature=1.0)
- **Error handling**: Failed requests return error as content string, never raise exceptions
- **Response parsing**: Standardizes all provider responses into `LLMResponse` format with tool call argument JSON parsing

### Default Model

From config schema: `"anthropic/claude-opus-4-5"` (configurable)

### Design Notes

- LiteLLM handles the actual HTTP calls and provider-specific API differences
- The provider abstraction is thin -- mostly routing and normalization
- No streaming support visible in the code
- No retry logic at the provider level

---

## 12. Configuration System

**Files**: `nanobot/config/schema.py`, `nanobot/config/loader.py`

### Schema (Pydantic v2)

```python
class Config:
    channels:
        whatsapp: WhatsAppConfig
        telegram: TelegramConfig
        discord: DiscordConfig
        feishu: FeishuConfig

    agent:
        workspace: str = "workspace"
        model: str = "anthropic/claude-opus-4-5"
        max_tokens: int = 8192
        temperature: float = 0.7
        max_iterations: int = 20        # ReAct loop ceiling
        restrict_to_workspace: bool     # Sandbox file operations

    providers:
        openrouter: ProviderConfig
        anthropic: ProviderConfig
        openai: ProviderConfig
        deepseek: ProviderConfig
        groq: ProviderConfig
        gemini: ProviderConfig
        zhipu: ProviderConfig
        moonshot: ProviderConfig
        vllm: ProviderConfig

    gateway:
        host: str = "localhost"
        port: int = 18790

    tools:
        brave_api_key: str | None
        shell_timeout: int = 60
        restrict_to_workspace: bool = False
```

### Provider Matching

`Config._match_provider(model)` maps model names to API keys via keyword matching. `Config.get_api_key(model)` provides fallback logic: model-specific match first, then first available key.

### Storage

- Config file: `~/.nanobot/config.json`
- Uses camelCase in JSON (snake_case internally)
- Bidirectional case conversion: `camel_to_snake()` / `snake_to_camel()`
- Environment variable override: `NANOBOT_` prefix with `__` as nested delimiter
- Migration support: `_migrate_config()` handles schema evolution

### Error Handling

Loading failures (JSON parse errors, validation failures) print warnings and return a default `Config()` rather than crashing.

---

## 13. Channels Architecture

**Files**: `nanobot/channels/base.py`, `nanobot/channels/manager.py`

### Plugin Architecture

- `BaseChannel`: Abstract class defining the channel interface
- `ChannelManager`: Coordinates multiple channel instances
- Each channel type (Telegram, Discord, WhatsApp, Feishu) implements `BaseChannel`

### Message Flow

```
User (Telegram/Discord/etc.)
    │
    v
Channel Plugin
    │
    v
InboundMessage
    │
    v
MessageBus (inbound queue)
    │
    v
AgentLoop._process_message()
    │
    v
OutboundMessage
    │
    v
MessageBus (outbound queue)
    │
    v
dispatch_outbound() -> channel callbacks
    │
    v
Channel Plugin -> User
```

### Bridge System

WhatsApp and Discord use Node.js bridges (in `bridge/` directory):
- The CLI's bridge builder downloads, installs npm dependencies, and builds these
- Communication between Python and Node.js is via WebSocket
- This allows using existing mature JS libraries for platform APIs

---

## 14. Cron and Heartbeat Services

### Cron Service (`nanobot/cron/service.py`)

**Schedule types**:
- `"at"`: One-time execution at a specific timestamp
- `"every"`: Recurring interval-based
- `"cron"`: Standard cron expression

**Implementation**:
- Uses asyncio tasks (not OS cron)
- Calculates next wake time across all enabled jobs
- Single async sleep, then re-arms after execution
- One-shot jobs auto-disable/delete after running
- Jobs persist to JSON on disk
- Job IDs: truncated UUIDs (`str(uuid.uuid4())[:8]`)
- Timestamps in milliseconds throughout

### Heartbeat Service (`nanobot/heartbeat/service.py`)

**Purpose**: Periodically wakes the agent to check a `HEARTBEAT.md` file

**Behavior**:
- Configurable interval (default 30 minutes)
- Checks if `HEARTBEAT.md` contains actionable content
- Filters out: empty lines, headers, HTML comments, unchecked checkboxes
- If substantive content found: triggers agent via callback
- Agent responds with `"HEARTBEAT_OK"` when no action needed
- `trigger_now()` for manual immediate check

---

## 15. Design Decisions and Tradeoffs

### Simplicity-First Philosophy

Nanobot makes aggressive simplicity tradeoffs:

| Decision | Benefit | Cost |
|----------|---------|------|
| ~3,400 lines total | Easy to understand, modify, fork | Limited features |
| Message-count history (50) | Simple, predictable | No token-aware truncation |
| No streaming | Simpler code path | User waits for full response |
| Asyncio-only (no threads) | No concurrency bugs | CPU-bound tasks block event loop |
| String-only tool returns | Universal interface | No structured tool outputs |
| File-based persistence | No database dependency | Limited query capability |
| JSONL sessions | Simple, appendable | No efficient random access |
| Single LiteLLM provider | Multi-provider support | Tied to LiteLLM's abstractions |

### Error Philosophy: Never Crash

A consistent pattern throughout nanobot: errors are caught and returned as strings, never raised. This applies to:
- LLM provider calls
- Tool execution
- Config loading
- Session loading

This makes the system robust but can hide bugs -- errors become invisible to users unless the agent explicitly reports them.

### Security Model

- Workspace restriction is opt-in (not default)
- Shell command deny-list uses regex patterns
- Path traversal prevention in filesystem tools
- No authentication between components (trust-based)
- Channel access control via user ID allowlists

### Sub-Agent Design

Using asyncio tasks instead of processes/threads is the defining architectural choice:
- **Lightweight**: No IPC overhead, shared memory
- **Limited**: No true parallelism, shared rate limits
- **Safe**: No recursive spawning (prevents fork bombs)
- **Simple**: No process management complexity

---

## 16. Comparison with Claude Code

| Aspect | Nanobot | Claude Code (inferred) |
|--------|---------|----------------------|
| **Codebase size** | ~3,400 lines | ~430,000+ lines |
| **Agent loop** | Simple ReAct, 20 max iterations | ReAct with extended thinking, context compression |
| **Context management** | 50-message window, no token counting | Token-aware truncation, automatic compression |
| **Sub-agents** | asyncio tasks, 15 max iterations | Separate processes with full capability |
| **Tool returns** | Strings only | Structured data |
| **Streaming** | No | Yes |
| **Provider support** | Multi-provider via LiteLLM | Anthropic-native |
| **Persistence** | File-based (JSONL, markdown) | Likely more sophisticated |
| **Channels** | Telegram, Discord, WhatsApp, Feishu | CLI-native, IDE integrations |
| **Security** | Opt-in workspace restriction | Permission system, sandboxing |
| **Skills** | Markdown files with YAML frontmatter | Similar (CLAUDE.md, skill definitions) |
| **Memory** | Two-tier (daily + long-term) markdown | Auto-memory with project scoping |
| **Scheduling** | Built-in cron + heartbeat | No built-in scheduling |

### Key Architectural Differences for Featherbot

If building a similar system, key lessons from nanobot:

1. **The ReAct loop is simple**: The core is just a while loop calling LLM, checking for tool calls, executing them, and repeating. Most complexity lives in the context building and tool implementations.

2. **Asyncio sub-agents work**: For lightweight background tasks, asyncio tasks with restricted tool sets are effective and simple. No need for process spawning.

3. **Progressive skill loading is smart**: Embedding full skill content only for always-on skills, while showing summaries for others, is an effective context window optimization.

4. **String-return tools are sufficient**: Despite the lack of type safety, returning strings from all tools keeps the interface universal and the code simple.

5. **Message-count history has limits**: Token-aware truncation would be more robust but adds significant complexity. For personal use, 50 messages is a reasonable heuristic.

6. **File-based persistence is adequate**: For a personal assistant, JSONL sessions and markdown memory files avoid database dependencies while providing sufficient functionality.

---

*Analysis complete. All core agent files examined: loop.py, context.py, subagent.py, memory.py, skills.py, tools/base.py, tools/registry.py, tools/filesystem.py, tools/shell.py, tools/web.py, tools/message.py, tools/spawn.py, bus/events.py, bus/queue.py, session/manager.py, providers/base.py, providers/litellm_provider.py, config/schema.py, config/loader.py, cli/commands.py, cron/service.py, heartbeat/service.py, channels/__init__.py.*
