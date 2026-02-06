Here's the complete `ARCHITECTURE.md` content:

---

# FeatherBot Architecture Analysis
## Deep Analysis of nanobot (HKUDS) — Reference Implementation

> Analysis date: 2026-02-06
> Source: https://github.com/HKUDS/nanobot (~3,428 lines of Python)
> Target: TypeScript reimplementation as **FeatherBot**
> Detailed sub-analyses: `analysis-core.md`, `analysis-memory-tools.md`, `analysis-channels.md`, `analysis-infra.md`

---

## Table of Contents

1. [Repository Overview](#1-repository-overview)
2. [Agent Loop (ReAct Pattern)](#2-agent-loop-react-pattern)
3. [Context Builder](#3-context-builder)
4. [Memory System](#4-memory-system)
5. [Skills System](#5-skills-system)
6. [Tool System](#6-tool-system)
7. [Sub-agent System](#7-sub-agent-system)
8. [Message Bus](#8-message-bus)
9. [Channels](#9-channels)
10. [Session Management](#10-session-management)
11. [Cron Scheduler](#11-cron-scheduler)
12. [Heartbeat System](#12-heartbeat-system)
13. [LLM Providers](#13-llm-providers)
14. [Configuration](#14-configuration)
15. [CLI](#15-cli)
16. [Message Flow (End-to-End)](#16-message-flow-end-to-end)
17. [Key Design Decisions & Recommendations](#17-key-design-decisions--recommendations)
18. [FeatherBot TypeScript Architecture](#18-featherbot-typescript-architecture)

---

## 1. Repository Overview

### File Tree

```
nanobot/
├── __init__.py
├── __main__.py                    # Entry point: python -m nanobot
├── agent/
│   ├── context.py                 # Prompt/context assembly (~140 lines)
│   ├── loop.py                    # ReAct agent loop (~220 lines)
│   ├── memory.py                  # Persistent memory (~100 lines)
│   ├── skills.py                  # Skill discovery/loading (~170 lines)
│   ├── subagent.py                # Background sub-agent spawning (~130 lines)
│   └── tools/
│       ├── base.py                # Abstract Tool base class (~100 lines)
│       ├── registry.py            # Tool registration + dispatch (~70 lines)
│       ├── shell.py               # Shell command execution (~110 lines)
│       ├── filesystem.py          # File read/write/edit/list (~200 lines)
│       ├── web.py                 # Web search (Brave) + fetch (~180 lines)
│       ├── message.py             # Send messages to channels (~80 lines)
│       ├── spawn.py               # Spawn sub-agent tool (~60 lines)
│       └── cron.py                # Cron management tool
├── bus/
│   ├── events.py                  # InboundMessage/OutboundMessage dataclasses (~35 lines)
│   └── queue.py                   # Async message bus (~80 lines)
├── channels/
│   ├── base.py                    # Abstract BaseChannel (~90 lines)
│   ├── manager.py                 # ChannelManager - init/start/dispatch (~130 lines)
│   ├── telegram.py                # Telegram bot via python-telegram-bot
│   ├── discord.py                 # Discord bot (raw gateway WebSocket)
│   ├── whatsapp.py                # WhatsApp via whatsapp-web.js bridge (WebSocket)
│   └── feishu.py                  # Feishu/Lark via WebSocket
├── cli/
│   └── commands.py                # CLI commands via Typer (~400 lines)
├── config/
│   ├── schema.py                  # Pydantic config models (~150 lines)
│   └── loader.py                  # Config load/save + migration (~90 lines)
├── cron/
│   ├── types.py                   # CronJob, CronSchedule dataclasses
│   └── service.py                 # CronService - job scheduling (~200 lines)
├── heartbeat/
│   └── service.py                 # HeartbeatService (~100 lines)
├── providers/
│   ├── base.py                    # Abstract LLMProvider + response types (~60 lines)
│   ├── litellm_provider.py        # LiteLLM multi-provider adapter (~170 lines)
│   └── transcription.py           # Audio transcription (Groq Whisper)
├── session/
│   └── manager.py                 # Session persistence (JSONL files)
├── skills/                        # Bundled SKILL.md files
│   ├── cron/SKILL.md
│   ├── github/SKILL.md
│   ├── skill-creator/SKILL.md
│   ├── summarize/SKILL.md
│   ├── tmux/SKILL.md
│   └── weather/SKILL.md
├── utils/
│   └── helpers.py                 # Utility functions
└── workspace/                     # Default workspace template
    ├── AGENTS.md                  # Agent behavior instructions
    ├── SOUL.md                    # Agent personality
    ├── USER.md                    # User profile template
    ├── TOOLS.md                   # Tool documentation
    ├── HEARTBEAT.md               # Periodic tasks
    └── memory/MEMORY.md           # Long-term memory template
```

### Dependency Stack (Python)

| Component | Library |
|-----------|---------|
| LLM | `litellm` (unified multi-provider) |
| CLI | `typer` + `rich` |
| Config | `pydantic` + `pydantic-settings` |
| HTTP | `httpx` (async) |
| WebSocket | `websockets` + `websocket-client` |
| Telegram | `python-telegram-bot` |
| Web parsing | `readability-lxml` |
| Cron | `croniter` |
| Logging | `loguru` |
| Async | `asyncio` (stdlib) |

---

## 2. Agent Loop (ReAct Pattern)

**File:** `nanobot/agent/loop.py` | **Class:** `AgentLoop`

### Architecture

The `AgentLoop` implements a standard **ReAct (Reason + Act)** pattern:

```
User Message -> LLM Thinks -> [Tool Call OR Text Response] -> Observe Result -> Loop
```

### Key Parameters

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `max_tool_iterations` | 20 | Prevents infinite loops |
| `max_tokens` | 8192 | Per-LLM-call token limit |
| `temperature` | 0.7 | Sampling temperature |

### Processing Flow

```
1. Message arrives (from bus or direct call)
2. Session retrieved/created for this channel:chat_id
3. ContextBuilder assembles: system prompt + history + current message
4. Loop begins:
   a. Send messages + tool definitions to LLM
   b. Parse response:
      - If text content only -> send response, break
      - If tool_calls -> execute each tool, add results to messages
      - If both -> send text, then execute tools
   c. Increment iteration counter
   d. If iterations >= max_tool_iterations -> force stop
   e. Loop back to (a) with updated messages
5. Save conversation to session
```

### Critical Design Details

1. **Tool results are appended inline** -- each tool call result becomes a `{"role": "tool", "tool_call_id": ..., "content": result}` message
2. **Assistant messages with tool calls are preserved** -- the full assistant turn (content + tool_calls) is added to the message list before executing tools
3. **Tool execution is sequential** -- tools are executed one at a time in order, not parallel
4. **Context per-session** -- `SpawnTool` and `MessageTool` have their context (channel, chat_id) updated before each processing run
5. **Two message pathways:**
   - Standard messages (`_process_message`): Full ReAct loop
   - System messages (`_process_system_message`): Sub-agent completions routed back to originating channel
6. **Direct processing** -- `process_direct()` allows CLI and cron to bypass the bus

### Error Handling

- LLM errors return error text as content (graceful degradation, no crash)
- Tool execution errors are caught and returned as error strings to the LLM
- Tool parameter validation happens before execution
- The loop continues even after tool errors (LLM can self-correct)

### FeatherBot Recommendations

- Use Vercel AI SDK's `generateText` with `maxSteps` (built-in ReAct loop) instead of manual loop
- Consider parallel tool execution (AI SDK supports this)
- Add token budget tracking per conversation
- Add streaming support from day one

---

## 3. Context Builder

**File:** `nanobot/agent/context.py` | **Class:** `ContextBuilder`

### System Prompt Assembly Order

```
System Prompt = Identity + Bootstrap Files + Memory + Skills
```

1. **Identity Block** -- Generated dynamically:
   - Agent name, capabilities list
   - Current timestamp, runtime info (OS, Python version)
   - Workspace path, key directories
   - Behavioral instructions

2. **Bootstrap Files** -- Loaded from workspace (all optional, missing files silently skipped):
   - `AGENTS.md` -- Agent behavior rules
   - `SOUL.md` -- Personality definition
   - `USER.md` -- User profile/preferences
   - `TOOLS.md` -- Tool documentation
   - `IDENTITY.md` -- Custom identity

3. **Memory Context** -- From `MemoryStore`:
   - Long-term memory (`MEMORY.md`)
   - Today's notes (`YYYY-MM-DD.md`)

4. **Skills** -- Two-tier loading:
   - **Always-loaded skills**: Full SKILL.md content included in prompt
   - **Available skills**: Summary only (name, description, availability). Agent uses `read_file` tool to load on demand

5. **Session Context** -- Current channel name + chat ID

### Message Assembly

```python
messages = [
    {"role": "system", "content": system_prompt},
    ...history,                    # Previous conversation turns (last 50)
    {"role": "user", "content": current_message}  # New message
]
```

### Media Handling

Images are base64-encoded and sent as multimodal content arrays.

### FeatherBot Recommendations

- Same layered prompt assembly pattern
- Add token counting and dynamic truncation (nanobot has none)
- Bootstrap files should be configurable (not hardcoded list)
- Keep the progressive skill loading pattern -- it's excellent

---

## 4. Memory System

**File:** `nanobot/agent/memory.py` | **Class:** `MemoryStore`

### Architecture

Memory is **file-based**, stored in the workspace. No database, no vector store, no embedding search.

```
workspace/
└── memory/
    ├── MEMORY.md          # Long-term persistent memory
    ├── 2026-02-06.md      # Today's daily notes
    ├── 2026-02-05.md      # Yesterday
    └── ...
```

### Two Memory Types

| Type | File | Purpose | Persistence |
|------|------|---------|-------------|
| Long-term | `MEMORY.md` | User preferences, facts, project context | Permanent until manually edited |
| Daily notes | `YYYY-MM-DD.md` | Session-specific notes, transient info | Per-day files |

### How Memory Works

1. **Reading**: `get_memory_context()` returns formatted string (long-term + today's notes), injected verbatim into system prompt every turn
2. **Writing**: The LLM uses the `write_file` / `edit_file` tools to update memory files -- no dedicated memory tool
3. **Querying**: `get_recent_memories(days=7)` reads last N days of daily notes
4. **No structured storage**: Everything is unstructured markdown text
5. **No semantic search**: Memory size directly impacts token usage with no retrieval mechanism

### FeatherBot Recommendations

- Start with file-based memory (simple, proven)
- Later add SQLite backend for structured queries
- Consider a dedicated `remember(key, value)` tool for explicit memory storage
- Add memory search/retrieval beyond "read the whole file"
- Consider embedding-based retrieval for large memory stores
- Keep daily notes concept -- useful for temporal context

---

## 5. Skills System

**File:** `nanobot/agent/skills.py` | **Class:** `SkillsLoader`

### Architecture

Skills are **prompt-fragment plugins** -- markdown instruction packages (NOT code plugins). Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
description: "Interact with GitHub repositories"
metadata: {"nanobot":{"requires":{"bins":["gh"],"env":["GITHUB_TOKEN"]},"always":false}}
---

# GitHub Skill

You can use the GitHub CLI (`gh`) to:
- List repositories: `gh repo list`
...
```

### Skill Discovery

Two search paths (workspace skills override built-in):
1. `~/.nanobot/workspace/skills/` -- User-created skills
2. `nanobot/skills/` -- Built-in bundled skills

### Two-Tier Loading Strategy (Critical Pattern)

1. **Always-loaded skills** (`always: true`): Full SKILL.md content included in every system prompt
2. **Available skills** (default): Only an XML summary in the prompt:
   ```xml
   <skill name="github" available="true" source="builtin">
   Interact with GitHub repositories
   </skill>
   ```
   Agent uses `read_file` tool to lazy-load full content on demand

This prevents system prompt bloat regardless of how many skills are installed.

### Requirement Checking

- **Binaries**: Checked via `shutil.which()` (is `gh` in PATH?)
- **Environment variables**: Checked via `os.environ.get()`
- Unavailable skills are marked `available="false"` with missing requirements listed

### FeatherBot Recommendations

- Keep the SKILL.md pattern -- simple and extensible
- Keep YAML frontmatter for metadata
- Keep the progressive loading strategy
- Consider TypeScript-based skills that can register their own tools programmatically
- Add a `tools` field to SKILL.md frontmatter for skill-specific tool registration

---

## 6. Tool System

**File:** `nanobot/agent/tools/`

### Architecture

```
Tool (ABC)                      # Abstract base: name, description, parameters, execute()
├── ExecTool (shell.py)         # Shell command execution
├── ReadFileTool (filesystem.py) # File reading
├── WriteFileTool (filesystem.py) # File writing
├── EditFileTool (filesystem.py)  # File editing (find-and-replace)
├── ListDirTool (filesystem.py)   # Directory listing
├── WebSearchTool (web.py)       # Brave Search API
├── WebFetchTool (web.py)        # URL content fetching
├── MessageTool (message.py)     # Send messages to channels
├── SpawnTool (spawn.py)         # Spawn sub-agents
└── CronTool (cron.py)          # Manage scheduled tasks

ToolRegistry                    # Registry: register, get, execute, get_definitions
```

### Tool Base Class

Every tool defines:
- `name: str` -- Unique identifier used in function calling (e.g., `"exec"`)
- `description: str` -- Text description sent to the LLM
- `parameters: dict` -- JSON Schema dict defining input parameters
- `execute(**kwargs) -> str` -- Async method that performs the action and returns a string result
- `validate_params(params) -> list[str]` -- Validates against JSON Schema
- `to_schema() -> dict` -- Converts to OpenAI function calling format

### Tool Registry

- **Never crashes** -- `execute()` catches ALL exceptions and returns error strings
- Validation before execution, errors returned as strings
- `get_definitions()` returns all tool schemas for LLM function calling

### Built-in Tool Details

| Tool | Key Features |
|------|-------------|
| **ExecTool** | Async subprocess, 60s timeout, regex deny patterns (rm -rf, fork bombs, etc.), 10K char output truncation, workspace restriction |
| **ReadFileTool** | UTF-8, validates file exists |
| **WriteFileTool** | Auto-creates parent dirs |
| **EditFileTool** | Find-and-replace, rejects ambiguous matches (>1 occurrence) |
| **ListDirTool** | Sorted listing with folder/file indicators |
| **WebSearchTool** | Brave Search API, 1-10 results with titles + URLs + snippets |
| **WebFetchTool** | Readability extraction, markdown/text modes, 50K char limit, URL validation, JSON/HTML/raw handling |
| **MessageTool** | Sends via bus, context-aware (current channel/chat_id) |
| **SpawnTool** | Delegates to SubagentManager, carries origin context |
| **CronTool** | add/list/remove actions, injects current channel/chat_id into job payload |

### FeatherBot Recommendations

- Use Zod schemas instead of JSON Schema (Vercel AI SDK native)
- Keep the string-return convention (all tools return strings to LLM)
- The safety guard pattern for shell is essential -- port it
- Consider typed tool results (Zod output schemas)

---

## 7. Sub-agent System

**File:** `nanobot/agent/subagent.py` | **Class:** `SubagentManager`

### Architecture

Sub-agents are **lightweight async tasks** running in the same event loop (not separate processes):

```
Main Agent -> spawn(task) -> asyncio.create_task(_run_subagent)
                                  |
                                  v
                             Mini ReAct loop (max 15 iterations)
                             Reduced tool set (no message, no spawn, no cron)
                             Fresh context (no session history)
                                  |
                                  v
                             _announce_result() -> system message via bus
                                  |
                                  v
                             Main agent summarizes for user
```

### Sub-agent Constraints

| Capability | Main Agent | Sub-Agent |
|-----------|------------|-----------|
| File read/write/edit | Yes | Yes |
| Shell execution | Yes | Yes |
| Web search/fetch | Yes | Yes |
| Send messages to user | Yes | **No** |
| Spawn more sub-agents | Yes | **No** (prevents recursion) |
| Cron management | Yes | **No** |
| Max iterations | 20 | **15** |

### FeatherBot Recommendations

- Keep the async task model (simple, effective)
- Add sub-agent status tracking (in-progress, completed, failed)
- Add sub-agent cancellation
- Set a time limit in addition to iteration limit
- Consider `Worker` threads for CPU-heavy tools only

---

## 8. Message Bus

**File:** `nanobot/bus/`

### Architecture

Queue-based pub/sub decoupling channels from the agent:

```
Channels --> [Inbound Queue] --> Agent Loop
Channels <-- [Outbound Queue] <-- Agent Loop
```

### Event Types

```python
@dataclass
class InboundMessage:
    channel: str        # "telegram", "whatsapp", etc.
    sender_id: str      # User identifier
    chat_id: str        # Chat/conversation identifier
    content: str        # Message text
    timestamp: datetime
    media: list[str]    # Media file paths
    metadata: dict      # Channel-specific data

    @property
    def session_key(self) -> str:
        return f"{channel}:{chat_id}"    # Unique session identifier

@dataclass
class OutboundMessage:
    channel: str
    chat_id: str
    content: str
    reply_to: str | None
    media: list[str]
    metadata: dict
```

### Key Design Details

- Two `asyncio.Queue` instances (unbounded, no backpressure)
- Single-consumer FIFO processing (sequential, no parallel message handling)
- Subscriber pattern for outbound: `ChannelManager._dispatch_outbound()` polls with 1s timeout
- Per-callback error handling prevents one channel failure from blocking others

### FeatherBot Recommendations

- Use TypeScript typed `EventEmitter` or async iterators
- Add message IDs for correlation (request -> response tracking)
- Consider message priority (system messages > user messages)
- Keep serial processing for simplicity initially

---

## 9. Channels

**File:** `nanobot/channels/`

### Architecture

```
BaseChannel (ABC)
├── TelegramChannel    # python-telegram-bot, long polling
├── WhatsAppChannel    # WebSocket to Node.js bridge (Baileys)
├── DiscordChannel     # Raw Discord Gateway WebSocket + REST
└── FeishuChannel      # lark-oapi SDK, WebSocket (separate thread)

ChannelManager         # Initializes, starts, routes outbound to channels
```

### BaseChannel Interface

```python
class BaseChannel(ABC):
    name: str                          # Channel identifier
    async def start() -> None          # Connect and listen (long-running)
    async def stop() -> None           # Disconnect and cleanup
    async def send(msg) -> None        # Send outbound message
    def is_allowed(sender_id) -> bool  # Allowlist check
    async def _handle_message(...)     # Shared: check allowlist, create InboundMessage, publish to bus
```

### Per-Channel Details

| Channel | Connection | Media Support | Special Features |
|---------|------------|---------------|------------------|
| **Telegram** | Long polling (no public IP needed) | Photos, voice, audio, documents | Voice transcription via Groq Whisper, markdown-to-HTML conversion |
| **WhatsApp** | WebSocket to Node.js bridge | Images, video, docs, voice (no transcription yet) | QR code auth, persistent auth state in `~/.nanobot/whatsapp-auth/` |
| **Discord** | Raw Gateway WebSocket | Attachments up to 20MB | Typing indicators, rate limit handling (429 retry), reply threading |
| **Feishu** | lark-oapi SDK WebSocket | Text only currently | Separate daemon thread (blocking SDK), message deduplication, thumbs-up "seen" reactions |

### Access Control

- Each channel config has `allow_from: list[str]`
- Empty list = open mode (all senders allowed)
- Compound IDs (e.g., Telegram's `"12345|username"`) split on `|` and each part checked
- Denied senders: silently dropped with warning log

### WhatsApp Bridge Architecture

```
Python (WhatsAppChannel) <--WebSocket--> Node.js (BridgeServer) <--Baileys--> WhatsApp Web
```

The bridge is a separate Node.js/TypeScript process with 3 files:
- `index.ts` -- Bootstrap, env config, graceful shutdown
- `server.ts` -- WebSocket hub, routes commands/events
- `whatsapp.ts` -- Baileys wrapper, QR auth, message extraction, auto-reconnect

### FeatherBot Recommendations

- Use `grammy` for Telegram (TypeScript-native, better types)
- Use `@whiskeysockets/baileys` directly for WhatsApp (no bridge needed in TypeScript!)
- Add a `TerminalChannel` for interactive CLI (first integration)
- Consider webhook support for Telegram in production
- Keep the `BaseChannel` + `ChannelManager` pattern

---

## 10. Session Management

**File:** `nanobot/session/manager.py`

### Architecture

Sessions are **per-conversation state** stored as JSONL files:

```
~/.nanobot/sessions/
├── telegram_12345.jsonl
├── whatsapp_1234567890.jsonl
└── cli_direct.jsonl
```

### Session Key Format

`{channel}:{chat_id}` -- unique identifier per conversation.

### JSONL File Format

```
{"_type": "metadata", "created_at": "...", "updated_at": "..."}
{"role": "user", "content": "Hello", "timestamp": "..."}
{"role": "assistant", "content": "Hi there!", "timestamp": "..."}
```

### History Truncation

`get_history(max_messages=50)` returns the last 50 messages. **No token counting, no summarization** -- simple message count window only.

### FeatherBot Recommendations

- Use SQLite instead of JSONL (better querying, concurrent access safety)
- Add token-aware truncation (count tokens, not just messages)
- Consider conversation summarization for long sessions
- Add session metadata (user info, preferences, active skills)

---

## 11. Cron Scheduler

**File:** `nanobot/cron/`

### Architecture

```
CronService
├── Job storage: ~/.nanobot/cron.json (persistent JSON)
├── Job types: cron expression | interval (every N seconds) | one-time (at timestamp)
├── Timer: asyncio.call_later() targeting next due job (NOT polling)
├── Execution: Calls agent.process_direct(message) when job fires
└── State: tracks nextRunAtMs, lastRunAtMs, lastStatus, lastError
```

### Job Types

| Type | Config | Example |
|------|--------|---------|
| Cron expression | `"cron_expr": "0 9 * * *"` | Every day at 9 AM |
| Interval | `"every_seconds": 3600` | Every hour |
| One-time | `"at": "2026-02-07T09:00:00"` | Once at specific time |

### Timer Mechanism (Efficient)

1. Service computes minimum `next_run_at` across all enabled jobs
2. Single `asyncio.call_later()` for that earliest deadline (not polling)
3. On fire: execute all due jobs, recompute, re-arm
4. One-shot jobs self-destruct after execution

### FeatherBot Recommendations

- Use `croner` (TypeScript, lightweight, standard cron syntax)
- Store jobs in SQLite (not JSON file) for concurrent access
- Keep the timer-based approach (efficient)
- Add job history/logs
- Add channel routing to cron jobs

---

## 12. Heartbeat System

**File:** `nanobot/heartbeat/service.py` | **Class:** `HeartbeatService`

### Architecture

Periodic self-wake mechanism:

```
Every 30 minutes (configurable):
  1. Read HEARTBEAT.md from workspace
  2. Filter non-actionable lines (headers, comments, empty checkboxes)
  3. If empty/no tasks -> skip
  4. If tasks exist -> send to agent: "Read HEARTBEAT.md, follow instructions"
  5. Agent processes tasks, may edit HEARTBEAT.md to mark complete
```

### Heartbeat vs Cron

| Aspect | Heartbeat | Cron |
|--------|-----------|------|
| Trigger | Fixed interval (30 min) | Flexible (cron expr, interval, one-shot) |
| Task source | Markdown file | Stored job definitions |
| Granularity | Coarse (30 min minimum) | Fine (minute-level) |
| Best for | Periodic review tasks | Time-specific reminders |

### FeatherBot Recommendations

- Keep this pattern -- simple and effective
- Consider structured task definitions
- Add heartbeat result logging

---

## 13. LLM Providers

**File:** `nanobot/providers/`

### Architecture

```
LLMProvider (ABC)
└── LiteLLMProvider     # Uses litellm.acompletion() for multi-provider support

LLMResponse             # content, tool_calls, finish_reason, usage
ToolCallRequest         # id, name, arguments
```

### LiteLLM Implementation

- **Single class** handles all LLMs via `litellm.acompletion()`
- Auto-detects provider from model name/API key prefix
- Supported: OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek, Groq, Zhipu, Moonshot, vLLM
- **No streaming** -- all request-response
- **No retry logic** at the provider level
- **Graceful error handling**: Returns error as content string, never throws
- Separate `GroqTranscriptionProvider` for Whisper audio transcription

### FeatherBot Recommendations

- Use **Vercel AI SDK** (`ai` package) instead of litellm
  - Native TypeScript, streaming support, built-in tool calling
  - `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, etc.
  - Built-in ReAct loop via `maxSteps`
- Add streaming support from day one
- Add retry logic with exponential backoff

---

## 14. Configuration

**File:** `nanobot/config/`

### Config Structure

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.nanobot/workspace",
      "model": "anthropic/claude-opus-4-5",
      "maxTokens": 8192,
      "temperature": 0.7,
      "maxToolIterations": 20
    }
  },
  "channels": {
    "telegram": { "enabled": true, "token": "...", "allowFrom": ["123456"] },
    "whatsapp": { "enabled": false, "bridgeUrl": "ws://localhost:3001" },
    "discord": { "enabled": false, "token": "" },
    "feishu": { "enabled": false, "appId": "", "appSecret": "" }
  },
  "providers": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "openrouter": { "apiKey": "sk-or-..." },
    "openai": { "apiKey": "" },
    "deepseek": { "apiKey": "" },
    "groq": { "apiKey": "" },
    "gemini": { "apiKey": "" }
  },
  "tools": {
    "web": { "search": { "apiKey": "BRAVE_KEY", "maxResults": 5 } },
    "exec": { "timeout": 60 },
    "restrictToWorkspace": false
  }
}
```

### Key Features

- **File**: `~/.nanobot/config.json` (camelCase JSON, snake_case internally)
- **Environment overrides**: `NANOBOT_` prefix with `__` as nested delimiter
- **Provider matching**: Maps model names to API keys via keyword matching
- **Migration**: Handles schema evolution
- **Error handling**: Invalid config -> warning + defaults (never crash)

### FeatherBot Recommendations

- Use **Zod** for config schema (runtime validation + type inference)
- Use `dotenv` for env vars + JSON config file
- Keep camelCase in JSON (JavaScript convention)

---

## 15. CLI

**File:** `nanobot/cli/commands.py`

### Commands

| Command | Purpose |
|---------|---------|
| `nanobot onboard` | Interactive setup: creates config, workspace, template files |
| `nanobot agent -m "message"` | Send a single message to the agent |
| `nanobot agent` | Interactive REPL mode |
| `nanobot gateway` | Start full server: agent + channels + cron + heartbeat |
| `nanobot status` | Show config, workspace, and API key status |
| `nanobot channels status/login` | Channel management |
| `nanobot cron list/add/remove/enable/run` | Scheduled tasks |

### Gateway Command (Main Entry Point)

```
1. Load config -> 2. MessageBus -> 3. LLMProvider -> 4. AgentLoop
5. ChannelManager -> 6. CronService -> 7. HeartbeatService
8. asyncio.gather(all services)
```

### FeatherBot Recommendations

- Use `commander` or `citty` for CLI
- Keep the same command structure
- Add `featherbot dev` for development with hot reload

---

## 16. Message Flow (End-to-End)

### Inbound (User -> Agent)

```
1. User sends "What's the weather?" on Telegram
2. TelegramChannel._on_message() receives update
3. Channel checks is_allowed(sender_id) -> passes
4. _handle_message() creates InboundMessage, publishes to bus
5. AgentLoop.run() consumes from inbound queue
6. _process_message():
   a. Get/create session for "telegram:12345"
   b. ContextBuilder assembles system prompt + history + current message
   c. LLM call with tools
   d. LLM calls web_search("weather today")
   e. ToolRegistry.execute("web_search", {"query": "weather today"})
   f. Result appended to messages
   g. LLM call again with tool result
   h. LLM responds: "It's 22C and sunny"
   i. bus.publish_outbound(OutboundMessage)
7. ChannelManager._dispatch_outbound() routes to TelegramChannel
8. TelegramChannel.send() formats and delivers to Telegram
9. Session saved with full history
```

### Cron Flow

```
CronService timer fires -> agent.process_direct(job.message)
-> Agent processes (no bus), uses session "system:cron"
-> If agent needs to message user, uses message tool with job's channel/chat_id
```

### Heartbeat Flow

```
HeartbeatService._tick() (every 30 min) -> reads HEARTBEAT.md
-> If actionable content: agent.process_direct(HEARTBEAT_PROMPT)
-> Agent reads/processes/updates HEARTBEAT.md via file tools
```

### Sub-agent Flow

```
User: "Research Hono vs Fastify in background"
-> Agent calls spawn(task="Research Hono vs Fastify")
-> SubagentManager creates asyncio task (returns immediately)
-> Agent responds: "Started background research"
-> Sub-agent runs own ReAct loop (max 15 iterations)
-> Sub-agent completes, announces result as system message via bus
-> Main agent picks up system message, summarizes for user
-> User receives: "Research complete: [findings]"
```

---

## 17. Key Design Decisions & Recommendations

### Q1: How does the agent loop handle tool call limits?
**nanobot**: Hard limit of `max_tool_iterations = 20`.
**FeatherBot**: Use Vercel AI SDK's `maxSteps`. Add secondary token budget limit.

### Q2: How is conversation history truncated?
**nanobot**: `get_history(max_messages=50)` -- simple message count, no token awareness.
**FeatherBot**: Token-aware truncation. Consider summarizing older messages.

### Q3: What's the memory format?
**nanobot**: Unstructured markdown files. Agent reads/writes via file tools.
**FeatherBot**: Start with markdown. Add SQLite later. Consider dedicated `remember(key, value)` tool.

### Q4: How are tool results formatted?
**nanobot**: All tools return plain strings as `{"role": "tool"}` messages.
**FeatherBot**: Same. Vercel AI SDK handles this automatically.

### Q5: How does the bus handle concurrent messages?
**nanobot**: `asyncio.Queue` -- serial processing, one at a time.
**FeatherBot**: Keep serial for simplicity. Add worker pool later if needed.

### Q6: How does sub-agent spawning work?
**nanobot**: `asyncio.create_task()` -- same event loop, lightweight.
**FeatherBot**: Promise-based async tasks. Worker threads only for CPU-heavy tools.

### Q7: How does heartbeat decide what to do?
**nanobot**: Reads HEARTBEAT.md. If content exists beyond headers/comments, sends to agent.
**FeatherBot**: Same. Consider structured task definitions with priority.

### Q8: How are skills injected without bloating the prompt?
**nanobot**: Two-tier: always-skills get full content, others get one-line summary. Agent lazy-loads via `read_file`.
**FeatherBot**: Same pattern. Excellent design.

### Q9: Error handling?
**nanobot**: Never crash. All errors become strings.
**FeatherBot**: Same. Add structured error types. Add retry for transient LLM errors.

### Q10: Security?
**nanobot**: Allowlisting, regex shell deny patterns, workspace restriction (opt-in), URL validation, output truncation. No rate limiting, no encryption at rest.
**FeatherBot**: All of the above, plus: secret management, rate limiting, audit logging.

---

## 18. FeatherBot TypeScript Architecture

### Target Structure

```
featherbot/
├── packages/
│   ├── core/                      # Agent engine
│   │   └── src/
│   │       ├── agent/             # loop.ts, context.ts, subagent.ts
│   │       ├── memory/            # store.ts, types.ts
│   │       ├── tools/             # registry.ts, shell.ts, filesystem.ts, web.ts, message.ts, spawn.ts
│   │       ├── skills/            # loader.ts, types.ts
│   │       ├── session/           # manager.ts (SQLite-backed)
│   │       ├── provider/          # index.ts (Vercel AI SDK)
│   │       └── config/            # schema.ts (Zod), loader.ts
│   ├── channels/                  # base.ts, manager.ts, telegram.ts, whatsapp.ts, discord.ts, terminal.ts
│   ├── bus/                       # bus.ts, types.ts
│   ├── scheduler/                 # cron.ts, heartbeat.ts
│   └── cli/                       # index.ts (commander)
├── skills/                        # Bundled SKILL.md plugins
├── workspace/                     # Default workspace template
├── docker/                        # Dockerfile, docker-compose.yml
├── package.json                   # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.json
├── biome.json
└── turbo.json
```

### Tech Stack Mapping

| Component | nanobot (Python) | FeatherBot (TypeScript) |
|-----------|-----------------|------------------------|
| Runtime | Python 3.11+ | Node.js 22 LTS |
| Package Manager | pip/uv | pnpm |
| LLM SDK | litellm | Vercel AI SDK (`ai`) |
| Config validation | Pydantic | Zod |
| CLI | Typer | Commander |
| HTTP | httpx | Native fetch |
| Telegram | python-telegram-bot | grammy |
| WhatsApp | whatsapp-web.js bridge | @whiskeysockets/baileys (native!) |
| Scheduling | croniter + asyncio | croner |
| Logging | loguru | pino |
| Storage | Files (JSONL, JSON, MD) | SQLite (better-sqlite3 / drizzle) |
| Testing | pytest | vitest |
| Linting | ruff | biome |
| Build | hatchling | tsup |
| Monorepo | N/A | turborepo |

### Implementation Order

1. **Config + types** -- Zod schemas, config loading, shared types
2. **LLM Provider** -- Vercel AI SDK integration with tool calling
3. **Tool system** -- Zod-based tool definitions, shell + filesystem tools
4. **Agent loop** -- `generateText` with `maxSteps` for ReAct
5. **Memory** -- File-based persistent memory
6. **Context builder** -- System prompt assembly
7. **Session management** -- SQLite-backed sessions
8. **Message bus** -- Typed async event bus
9. **Terminal channel** -- First end-to-end test
10. **CLI commands** -- onboard, agent, status, gateway
11. **Skills system** -- Filesystem-based skill loading
12. **Telegram channel** -- grammy integration
13. **WhatsApp channel** -- baileys integration
14. **Cron scheduler** -- croner-based scheduling
15. **Heartbeat** -- Periodic wake-up service
16. **Sub-agents** -- Async background tasks
17. **Gateway** -- Unified startup
18. **Docker** -- Containerization
19. **Web search tool** -- Brave/Tavily
20. **Additional skills** -- GitHub, weather, etc.

### Key Advantages of TypeScript Reimplementation

1. **No WhatsApp bridge needed** -- Baileys is native JavaScript, eliminating the Node.js bridge process entirely
2. **Vercel AI SDK** -- Built-in ReAct loop (`maxSteps`), streaming, parallel tool execution, typed tool definitions
3. **Zod everywhere** -- Config validation, tool schemas, and API types from a single schema definition
4. **SQLite over JSONL** -- Better concurrent access, queryable sessions, structured memory
5. **Type safety** -- Catch integration errors at compile time instead of runtime
6. **Single runtime** -- No Python + Node.js dual process, everything in one Node.js process

---

*This document was generated from a comprehensive analysis of every file in the nanobot repository (https://github.com/HKUDS/nanobot) by a team of 4 parallel analysis agents. See the detailed sub-analyses in `analysis-core.md`, `analysis-memory-tools.md`, `analysis-channels.md`, and `analysis-infra.md` for file-by-file breakdowns.*

---

That's the complete document. You can copy it and save it as `ARCHITECTURE.md` in your project directory. The 4 detailed sub-analysis files are already saved there by the team agents.

To summarize what we accomplished in Phase 1:

**5 files produced:**
- `analysis-core.md` -- Agent loop, context builder, sub-agents, tool system (~1,044 lines)
- `analysis-memory-tools.md` -- Memory, skills, tool framework (~686 lines)  
- `analysis-channels.md` -- Channels, bus, sessions, WhatsApp bridge (~974 lines)
- `analysis-infra.md` -- Cron, heartbeat, providers, config, CLI, Docker (~788 lines)
- `ARCHITECTURE.md` -- Unified architecture document (above, ~800 lines)

**Every file in nanobot was read and analyzed.** Ready to move to Phase 2 (implementation) whenever you are.
