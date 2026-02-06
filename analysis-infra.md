# Nanobot Infrastructure Analysis: Cron, Heartbeat, Providers, Config, CLI & Docker

## Table of Contents

1. [Cron System (`nanobot/cron/`)](#1-cron-system)
2. [Heartbeat System (`nanobot/heartbeat/`)](#2-heartbeat-system)
3. [LLM Providers (`nanobot/providers/`)](#3-llm-providers)
4. [Configuration System (`nanobot/config/`)](#4-configuration-system)
5. [CLI (`nanobot/cli/`)](#5-cli)
6. [Docker Support](#6-docker-support)
7. [Build & Packaging (`pyproject.toml`)](#7-build--packaging)
8. [Security Considerations](#8-security-considerations)
9. [Cross-Cutting Integration Map](#9-cross-cutting-integration-map)

---

## 1. Cron System

### 1.1 Overview

The cron system provides scheduled task execution for the agent. It supports three scheduling modes and persists jobs to disk as JSON. The architecture consists of three layers: type definitions, the service engine, and the agent tool interface.

### 1.2 File: `nanobot/cron/types.py` -- Data Model

Defines the core data structures using Python `dataclasses`:

**`CronSchedule`**
- `kind: str` -- one of `"at"`, `"every"`, or `"cron"`
  - `"at"` -- one-time execution at a specific ISO timestamp
  - `"every"` -- recurring execution at a fixed interval
  - `"cron"` -- standard cron expression scheduling
- `at: str | None` -- ISO timestamp for one-time jobs
- `every_seconds: int | None` -- interval in seconds for recurring jobs
- `cron_expr: str | None` -- standard 5-field cron expression (e.g., `"0 9 * * *"`)
- `timezone: str | None` -- timezone for cron expressions (e.g., `"America/New_York"`)

**`CronPayload`**
- `action: str` -- either `"system_event"` or `"agent_turn"`
  - `"system_event"` -- fires a system-level event (e.g., send a static message)
  - `"agent_turn"` -- triggers a full agent processing turn (agent executes instructions)
- `message: str` -- the reminder text or task instruction
- `channel: str | None` -- delivery channel (e.g., `"telegram"`, `"whatsapp"`)
- `chat_id: str | None` -- target chat identifier for delivery

**`CronJobState`**
- `next_run_at: int | None` -- epoch ms of next scheduled run
- `last_run_at: int | None` -- epoch ms of last execution
- `last_status: str | None` -- result of last run (e.g., `"ok"`, `"error"`)
- `last_error: str | None` -- error message from last failed run

**`CronJob`**
- `id: str` -- unique job identifier
- `name: str` -- human-readable job name
- `enabled: bool` -- whether the job is active (default `True`)
- `schedule: CronSchedule` -- scheduling configuration
- `payload: CronPayload` -- what to do when triggered
- `state: CronJobState` -- runtime tracking state
- `created_at: str` -- ISO creation timestamp
- `updated_at: str` -- ISO last-modified timestamp
- `delete_after_run: bool` -- if `True`, job self-destructs after one execution (default `False`)

**`CronStore`**
- `version: int` -- schema version for migration (default `1`)
- `jobs: list[CronJob]` -- all persisted jobs

### 1.3 File: `nanobot/cron/service.py` -- Service Engine

**Class: `CronService`**

Core scheduling engine that manages job lifecycle, computes next-run times, and triggers execution.

**Constructor:**
- Accepts a `store_path` (file path for JSON persistence) and a `callback` (async function invoked when a job fires)
- Lazily loads the store from disk on first access

**Key Methods:**

| Method | Signature | Purpose |
|--------|-----------|---------|
| `add_job()` | `(job: CronJob) -> None` | Registers a job, computes next_run_at, persists to disk |
| `remove_job()` | `(job_id: str) -> bool` | Deletes a job by ID, returns success |
| `enable_job()` | `(job_id: str, enabled: bool) -> bool` | Toggles job active state |
| `run_job()` | `(job_id: str) -> None` | Manually triggers immediate execution |
| `list_jobs()` | `() -> list[CronJob]` | Returns all registered jobs |
| `start()` | `() -> None` | Begins the scheduling loop |
| `stop()` | `() -> None` | Halts the scheduling loop |

**Schedule Computation (`_compute_next_run`):**
- `"at"` mode: Parses ISO timestamp, returns epoch ms. Returns `None` if the time has passed (one-shot).
- `"every"` mode: Adds `every_seconds * 1000` to current epoch ms.
- `"cron"` mode: Uses the `croniter` library to compute the next matching time. Supports optional timezone via `pytz`/`zoneinfo`.
- Returns `None` on parse failure (graceful degradation).

**Timer System (`_arm_timer`):**
- Does NOT continuously poll. Instead, computes the minimum `next_run_at` across all enabled jobs.
- Schedules a single `asyncio.call_later()` for that earliest time.
- On timer fire, executes all due jobs, recomputes schedules, re-arms the timer.
- This is efficient -- the service sleeps between events rather than polling.

**Job Execution Flow:**
1. Timer fires, calls `_on_timer()`
2. Iterates all enabled jobs where `next_run_at <= now`
3. Invokes the async `callback(job)` for each due job
4. Updates `job.state.last_run_at`, `last_status`
5. If `delete_after_run` is True, removes the job
6. Otherwise, recomputes `next_run_at`
7. Persists store, re-arms timer

**Persistence:**
- Jobs stored as JSON at `~/.nanobot/cron.json` (configurable)
- Store loaded lazily on first access
- Saved after every mutation (add, remove, enable, execute)

### 1.4 File: `nanobot/agent/tools/cron.py` -- Agent Tool Interface

**Class: `CronTool(Tool)`**

Exposes cron functionality to the LLM agent as a callable tool.

**Tool Name:** `cron`

**Actions (via `action` parameter):**
- `"add"` -- Create a new scheduled job
  - Parameters: `name`, `message`, `every_seconds` (optional), `cron_expr` (optional)
  - Must provide exactly one of `every_seconds` or `cron_expr`
- `"list"` -- List all scheduled jobs
- `"remove"` -- Delete a job by `job_id`

**Context Injection:**
- `set_context(channel, chat_id)` -- Sets the delivery target for job payloads
- When a job is created, the current session's channel and chat_id are attached to the payload

**Integration Flow:**
1. Agent receives user request like "remind me every day at 9am"
2. LLM calls `cron` tool with `action="add"`, `cron_expr="0 9 * * *"`, `message="..."`
3. `CronTool._add_job()` creates `CronSchedule` + `CronJob` objects
4. Calls `CronService.add_job()` to register and persist
5. Returns confirmation string to LLM

### 1.5 Cron Skill (`nanobot/skills/cron/SKILL.md`)

Provides natural language instructions for the LLM on how to use the cron tool:
- **Reminder mode**: Static message delivered directly to user
- **Task mode**: Message is a task description; agent executes instructions and sends results
- Maps natural language to parameters (e.g., "every 20 minutes" -> `every_seconds: 1200`)
- Supports both interval and cron expression syntax

### 1.6 Cron Syntax Support

| Type | Format | Example |
|------|--------|---------|
| One-time | ISO 8601 timestamp | `"2024-12-25T09:00:00"` |
| Interval | Seconds integer | `1200` (every 20 min) |
| Cron expression | Standard 5-field | `"0 9 * * *"` (daily at 9am) |
| Cron with timezone | 5-field + TZ | `"0 9 * * *"` + `timezone: "US/Eastern"` |

The cron expression parsing uses the `croniter` library, which supports standard 5-field POSIX cron syntax (minute, hour, day-of-month, month, day-of-week).

---

## 2. Heartbeat System

### 2.1 Overview

The heartbeat system is a periodic wake-up mechanism that reads a task file (`HEARTBEAT.md`) and triggers agent turns when actionable tasks are found. It is simpler than the cron system -- it has a single fixed interval and a single task source.

### 2.2 File: `nanobot/heartbeat/service.py`

**Class: `HeartbeatService`**

**Constructor Parameters:**
- `callback: Callable` -- async function to invoke when actionable tasks are found
- `workspace_path: Path` -- path to workspace directory containing `HEARTBEAT.md`
- `interval_seconds: int` -- check interval (default: `1800` = 30 minutes)

**Key Methods:**

| Method | Signature | Purpose |
|--------|-----------|---------|
| `start()` | `() -> None` | Launches the periodic asyncio loop |
| `stop()` | `() -> None` | Cancels the loop |
| `_tick()` | `() -> None` | Single heartbeat check |
| `trigger_now()` | `() -> None` | Manual immediate check |

**Decision Logic (`_tick`):**
1. Reads `{workspace_path}/HEARTBEAT.md`
2. Calls `_is_heartbeat_empty()` to determine if actionable content exists
3. If empty/no tasks -> logs "skipping" at debug level, returns
4. If tasks found -> invokes `callback` with the file contents as the agent prompt
5. Agent processes instructions and may respond with `HEARTBEAT_OK` if no action needed

**Empty Detection (`_is_heartbeat_empty`):**
Filters out non-actionable lines:
- Blank lines
- Markdown headers (`# ...`)
- HTML comments (`<!-- ... -->`)
- Unchecked checkbox items (`- [ ]`)

If no actionable content remains after filtering, returns `True` (empty).

**Error Handling:**
- File read failures (IOError) logged and silently skipped
- Callback execution errors caught and logged at error level
- Service continues running even after individual tick failures

### 2.3 Workspace File: `workspace/HEARTBEAT.md`

Template file with sections:
- `## Active Tasks` -- user adds periodic tasks here (e.g., `- [ ] Check weather forecast`)
- `## Completed` -- archive section
- Comments explaining the 30-minute check interval

### 2.4 How Heartbeat Integrates with Agent

Per `workspace/AGENTS.md`, the agent is instructed to:
- Use `edit_file` to add/remove tasks from `HEARTBEAT.md`
- Use `write_file` to completely rewrite the task list
- Prefer heartbeat over cron for recurring/periodic tasks (heartbeat is simpler)
- Keep the file small to minimize token usage (file contents become the LLM prompt)

### 2.5 Heartbeat vs Cron: Design Comparison

| Aspect | Heartbeat | Cron |
|--------|-----------|------|
| Trigger | Fixed interval (30 min default) | Flexible (cron expr, interval, one-shot) |
| Task source | Single file (`HEARTBEAT.md`) | Stored job definitions |
| Granularity | Coarse (30 min minimum) | Fine (minute-level) |
| Persistence | Markdown file in workspace | JSON store in `~/.nanobot/` |
| User edit | Direct file editing | CLI or agent tool |
| Best for | Periodic review tasks | Time-specific reminders/scheduled actions |

---

## 3. LLM Providers

### 3.1 Overview

The provider system uses a two-layer architecture: an abstract base class defining the interface, and a single concrete implementation (`LiteLLMProvider`) that supports multiple LLM backends through the `litellm` library.

### 3.2 File: `nanobot/providers/base.py` -- Abstract Interface

**`ToolCallRequest` (dataclass)**
- `id: str` -- unique identifier for the tool call
- `name: str` -- function name to invoke
- `arguments: dict` -- parsed arguments dictionary

**`LLMResponse` (dataclass)**
- `content: str` -- text response from the model
- `tool_calls: list[ToolCallRequest]` -- requested tool invocations (default empty)
- `finish_reason: str` -- completion status (default `"stop"`)
- `usage: dict` -- token usage statistics (default empty)
- `has_tool_calls: bool` (property) -- convenience check for non-empty tool_calls

**`LLMProvider` (ABC)**
- `__init__(self, api_key: str, api_base: str | None = None)` -- constructor
- `async chat(self, messages, tools=None, model=None, max_tokens=None, temperature=None) -> LLMResponse` -- abstract
- `get_default_model(self) -> str` -- abstract

### 3.3 File: `nanobot/providers/litellm_provider.py` -- Concrete Implementation

**Class: `LiteLLMProvider(LLMProvider)`**

**Provider Detection (Constructor):**
The provider type is auto-detected from the API key prefix:

| Key Prefix | Provider | Model Prefix |
|------------|----------|-------------|
| `sk-or-` | OpenRouter | `openrouter/` |
| `sk-ant-` | Anthropic | `anthropic/` (via litellm) |
| `sk-` (generic) | OpenAI | (none) |
| Custom `api_base` | vLLM/custom | `hosted_vllm/` |
| Gemini key pattern | Google Gemini | `gemini/` |
| DeepSeek key pattern | DeepSeek | `deepseek/` |
| Zhipu key pattern | Zhipu/Z.ai | `zai/` |
| Groq key pattern | Groq | `groq/` |
| Moonshot key pattern | Moonshot/Kimi | `moonshot/` |

**Model Prefixing:**
The `_apply_prefix(model)` method ensures the correct provider prefix is applied. For example, if using OpenRouter and the model is `"anthropic/claude-3-opus"`, it becomes `"openrouter/anthropic/claude-3-opus"`.

**Chat Implementation:**
```
async def chat(self, messages, tools=None, model=None, max_tokens=None, temperature=None) -> LLMResponse
```
1. Applies model prefix
2. Constructs kwargs for `litellm.acompletion()`
3. Passes `tools` in OpenAI function-calling format
4. Awaits response
5. Parses via `_parse_response()`
6. On exception, returns `LLMResponse(content=error_msg, finish_reason="error")`

**Response Parsing (`_parse_response`):**
- Extracts `content` from `choices[0].message.content`
- Iterates `choices[0].message.tool_calls` if present
- Converts tool call arguments from JSON string to dict
- Extracts usage stats (`prompt_tokens`, `completion_tokens`, `total_tokens`)

**Streaming:**
The implementation does **NOT** support streaming. All calls use `litellm.acompletion()` which returns complete responses. There is no `acompletion_stream()` or chunk handling.

**Tool Calling Flow:**
1. `AgentLoop` calls `provider.chat(messages=..., tools=tool_definitions)`
2. `tool_definitions` are in OpenAI function-calling format (generated by `ToolRegistry.get_definitions()`)
3. Provider passes them through to `litellm.acompletion(tools=...)`
4. litellm handles format conversion for non-OpenAI providers (e.g., Anthropic tool format)
5. Response parsed into `ToolCallRequest` objects
6. Returned to `AgentLoop` for execution

### 3.4 File: `nanobot/providers/transcription.py` -- Audio Transcription

**Class: `GroqTranscriptionProvider`**

Specialized provider for voice message transcription (not part of the LLM provider hierarchy).

- **API:** Groq Whisper API (`https://api.groq.com/openai/v1/audio/transcriptions`)
- **Model:** `whisper-large-v3`
- **Method:** `async transcribe(audio_path: str) -> str`
- **Auth:** `GROQ_API_KEY` environment variable or constructor parameter
- **Timeout:** 60 seconds
- Returns empty string on any failure (graceful degradation)

### 3.5 Provider Architecture Diagram

```
LLMProvider (ABC)
    |
    +-- LiteLLMProvider
            |
            +-- litellm.acompletion() --> OpenAI, Anthropic, OpenRouter,
                                          Gemini, DeepSeek, Groq, Zhipu,
                                          Moonshot, vLLM/custom

GroqTranscriptionProvider (standalone, not subclass of LLMProvider)
```

---

## 4. Configuration System

### 4.1 Overview

Configuration uses Pydantic `BaseSettings` for schema validation, JSON file storage at `~/.nanobot/config.json`, and supports environment variable overrides with the `NANOBOT_` prefix.

### 4.2 File: `nanobot/config/schema.py` -- Schema Definition

**Class: `Config(BaseSettings)`**

**Agent Settings:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `workspace` | `str` | `"~/.nanobot/workspace"` | Path to workspace directory |
| `model` | `str` | `"openai/gpt-4o"` | Default LLM model identifier |
| `max_tokens` | `int` | `4096` | Max tokens per LLM response |
| `max_turns` | `int` | `25` | Max agent loop iterations per request |
| `temperature` | `float` | `0.7` | LLM sampling temperature |

**LLM Provider API Keys:**
| Field | Type | Description |
|-------|------|-------------|
| `api_key` | `str \| None` | Primary/fallback API key |
| `api_base` | `str \| None` | Custom API base URL |
| `openrouter_api_key` | `str \| None` | OpenRouter key |
| `anthropic_api_key` | `str \| None` | Anthropic key |
| `openai_api_key` | `str \| None` | OpenAI key |
| `groq_api_key` | `str \| None` | Groq key |
| `deepseek_api_key` | `str \| None` | DeepSeek key |
| `gemini_api_key` | `str \| None` | Google Gemini key |
| `zhipu_api_key` | `str \| None` | Zhipu/Z.ai key |
| `moonshot_api_key` | `str \| None` | Moonshot/Kimi key |

**Channel Configurations:**

*WhatsApp:*
- `whatsapp_enabled: bool` (default `False`)
- `whatsapp_bridge_url: str` (default `"ws://localhost:3001"`)
- Connects via WebSocket bridge (Node.js bridge in `bridge/` directory)

*Telegram:*
- `telegram_enabled: bool` (default `False`)
- `telegram_bot_token: str | None`
- `telegram_proxy: str | None` -- HTTP proxy support

*Discord:*
- `discord_enabled: bool` (default `False`)
- `discord_bot_token: str | None`
- Uses gateway WebSocket with configurable intents

*Feishu/Lark:*
- `feishu_enabled: bool` (default `False`)
- `feishu_app_id: str | None`
- `feishu_app_secret: str | None`
- Uses WebSocket long connection

**Gateway Settings:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gateway_host` | `str` | `"0.0.0.0"` | Server bind address |
| `gateway_port` | `int` | `18790` | Server port |

**Tool Settings:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `brave_api_key` | `str \| None` | `None` | Brave Search API key |
| `exec_timeout` | `int` | `60` | Shell command timeout (seconds) |
| `restrict_to_workspace` | `bool` | `False` | Sandbox file/shell access |

**Heartbeat Settings:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `heartbeat_interval` | `int` | `1800` | Heartbeat check interval in seconds |

**Security Settings:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allow_from` | `list[str]` | `[]` | Allowlisted user IDs (empty = allow all) |

**Provider Matching (`_match_provider()`):**
Selects the appropriate API key based on model name keywords:
- `"claude"` / `"anthropic"` -> `anthropic_api_key`
- `"gpt"` / `"openai"` / `"o1"` / `"o3"` -> `openai_api_key`
- `"gemini"` -> `gemini_api_key`
- `"deepseek"` -> `deepseek_api_key`
- `"groq"` -> `groq_api_key`
- `"glm"` / `"zhipu"` -> `zhipu_api_key`
- `"moonshot"` / `"kimi"` -> `moonshot_api_key`
- Falls back to `api_key` if no match

**Environment Variable Override:**
- Prefix: `NANOBOT_`
- Nested delimiter: `__`
- Example: `NANOBOT_ANTHROPIC_API_KEY=sk-ant-...`

### 4.3 File: `nanobot/config/loader.py` -- Loading & Persistence

**Key Functions:**

| Function | Signature | Purpose |
|----------|-----------|---------|
| `load_config()` | `() -> Config` | Load from `~/.nanobot/config.json`, migrate, validate |
| `save_config()` | `(config: Config) -> None` | Persist to disk |
| `get_config_path()` | `() -> Path` | Returns `~/.nanobot/config.json` |

**Case Conversion:**
JSON files use camelCase (e.g., `apiKey`, `maxTokens`), while Python uses snake_case. The loader handles bidirectional conversion:
- `camel_to_snake()` -- on load
- `snake_to_camel()` -- on save
- `convert_keys()` / `convert_to_camel()` -- recursive dict/list processing

**Migration (`_migrate_config`):**
Handles schema changes, e.g., moving `tools.exec.restrictToWorkspace` to `tools.restrictToWorkspace`.

**Error Handling:**
- Invalid JSON -> warning + default Config
- Pydantic validation error -> warning + default Config
- Missing file -> default Config (no error)

### 4.4 Config File Location

```
~/.nanobot/
  config.json       -- Main configuration (camelCase JSON)
  cron.json          -- Cron job store
  sessions/          -- Session history (JSONL files)
  workspace/         -- Agent workspace
    AGENTS.md        -- Agent instructions
    SOUL.md          -- Personality definition
    HEARTBEAT.md     -- Heartbeat tasks
    TOOLS.md         -- Tool documentation
    USER.md          -- User preferences
    memory/
      MEMORY.md      -- Long-term memory
```

---

## 5. CLI

### 5.1 Overview

The CLI is built with **Typer** (Click wrapper) and **Rich** for terminal formatting. It provides commands for setup, agent interaction, channel management, cron management, and running the gateway server.

### 5.2 File: `nanobot/cli/commands.py`

**Entry Point:** `nanobot/__main__.py` imports `app` from `nanobot.cli.commands` and calls `app()`.

**Top-Level Commands:**

| Command | Description |
|---------|-------------|
| `nanobot onboard` | Interactive setup wizard -- creates `~/.nanobot/`, config file, workspace templates |
| `nanobot status` | Shows system status: API key configuration, enabled channels, workspace path |
| `nanobot gateway` | Starts the full nanobot server (message bus + provider + agent + channels + cron + heartbeat) |
| `nanobot agent` | Direct agent interaction (single message or interactive REPL mode) |

**Channel Subcommands (`nanobot channels`):**

| Command | Description |
|---------|-------------|
| `channels status` | Shows which channels are enabled (WhatsApp, Discord, Telegram, Feishu) |
| `channels login` | WhatsApp device linking via QR code |

**Cron Subcommands (`nanobot cron`):**

| Command | Description |
|---------|-------------|
| `cron list` | Lists all scheduled jobs with status |
| `cron add` | Creates a new job (supports `--every`, `--cron`, `--at`, `--name`, `--message`, `--deliver`, `--to`, `--channel`) |
| `cron remove` | Removes a job by ID |
| `cron enable` | Enables/disables a job |
| `cron run` | Manually triggers a job |

### 5.3 Gateway Command -- Orchestration

The `gateway` command is the primary runtime entry point. It orchestrates:

1. **Config loading** via `load_config()`
2. **Message Bus** (`MessageBus`) initialization for event routing
3. **LLM Provider** (`LiteLLMProvider`) creation with matched API key from config
4. **Agent Loop** (`AgentLoop`) setup with provider, tools, and context
5. **Channel Manager** (`ChannelManager`) starts enabled channels (Telegram, Discord, WhatsApp, Feishu)
6. **Cron Service** (`CronService`) starts with callback wired to agent processing
7. **Heartbeat Service** (`HeartbeatService`) starts with callback wired to agent processing
8. **HTTP Gateway** server on configured host:port

### 5.4 Agent Command -- Direct Interaction

Two modes:
- **Single message:** `nanobot agent "What is the weather?"` -- processes one message and exits
- **Interactive:** `nanobot agent` (no args) -- enters REPL with Rich-formatted prompt

---

## 6. Docker Support

### 6.1 Dockerfile

**Base Image:** `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`
- Uses the `uv` package manager (fast Python package installer)
- Based on Debian Bookworm slim

**Build Stages:**

1. **System dependencies:** Installs Node.js 20 (from Nodesource) for WhatsApp bridge
2. **Python dependencies:** Copies `pyproject.toml`, runs `uv pip install` with layer caching
3. **Source copy:** Copies full source tree
4. **Bridge build:** `cd bridge && npm install && npm run build` (compiles TypeScript WhatsApp bridge)
5. **Config directory:** Creates `/root/.nanobot`

**Exposed Port:** `18790` (gateway)

**Default Command:** `nanobot status`

**Key Design Decisions:**
- Multi-layer caching: dependencies installed before source copy for faster rebuilds
- Single-image approach: both Python app and Node.js bridge in one container
- Uses `uv` instead of `pip` for faster installs

### 6.2 `.dockerignore`

Excludes: `__pycache__`, `*.pyc/pyo/pyd`, `*.egg-info`, `dist/`, `build/`, `.git`, `.env`, `.assets`, `node_modules/`, `bridge/dist/`, `workspace/`

Notable: `workspace/` is excluded, meaning the container starts with a fresh workspace. Users must mount their workspace or run `onboard` inside the container.

### 6.3 Docker Deployment Pattern

Based on the Dockerfile and gateway command:

```
docker run -p 18790:18790 \
  -v ~/.nanobot:/root/.nanobot \
  -e NANOBOT_API_KEY=sk-... \
  -e NANOBOT_TELEGRAM_BOT_TOKEN=... \
  nanobot gateway
```

Key considerations:
- Mount `~/.nanobot` to persist config, sessions, cron jobs, and workspace
- Pass API keys via environment variables (not baked into image)
- No docker-compose.yml found in the repository -- single-container deployment
- Port 18790 for gateway HTTP endpoint

---

## 7. Build & Packaging

### 7.1 `pyproject.toml`

**Package Identity:**
- Name: `nanobot-ai`
- Version: `0.1.3.post4`
- License: MIT
- Python: `>=3.11`

**Core Dependencies:**
| Package | Purpose |
|---------|---------|
| `typer[all]` | CLI framework |
| `rich` | Terminal formatting |
| `litellm` | Multi-provider LLM abstraction |
| `pydantic` | Data validation / config schema |
| `pydantic-settings` | Environment variable config |
| `websockets` | WhatsApp bridge communication |
| `httpx` | Async HTTP client |
| `loguru` | Structured logging |
| `croniter` | Cron expression parsing |
| `python-telegram-bot` | Telegram channel |
| `lark-oapi` | Feishu/Lark channel |

**CLI Entry Point:**
```toml
[project.scripts]
nanobot = "nanobot.cli.commands:app"
```

**Build System:** Hatchling with special config to include non-Python files (SKILL.md, shell scripts).

**Dev Dependencies:**
- `pytest`, `pytest-asyncio` -- testing
- `ruff` -- linting (line length 100, rules: E, F, I, W)

---

## 8. Security Considerations

### 8.1 From `SECURITY.md`

**API Key Management:**
- Store keys in `~/.nanobot/config.json` with `chmod 0600` permissions
- Support for environment variables (`NANOBOT_` prefix)
- Never commit keys to version control
- OS credential managers recommended for production

**Access Control (`allow_from`):**
- Empty list = allow all users (designed for personal use only)
- Production: must configure `allow_from` with specific user IDs
- Per-channel user ID matching

**Shell Execution Safety (`ExecTool`):**
- Default deny patterns block: `rm -rf`, `rm -r`, `format`, `mkfs`, `dd`, `shutdown`, `reboot`, fork bombs
- Regex-based pattern matching (best-effort, not foolproof)
- `restrict_to_workspace` flag prevents path traversal outside workspace
- Configurable timeout (default 60s)
- Output truncation at 10,000 characters

**Known Limitations (documented):**
- No built-in rate limiting
- Plain-text config storage (no encryption at rest)
- Limited command filtering (regex-based, bypassable)
- No audit logging built-in

**Production Security Checklist (from SECURITY.md):**
1. API keys stored securely
2. Config file permissions set to 0600
3. `allow_from` configured
4. Running as limited-privilege user
5. Container isolation recommended
6. Dependencies audited (`pip-audit`)
7. Logging enabled
8. Directory permissions: 700 for dirs, 600 for files
9. Regular dependency updates

### 8.2 Workspace Sandboxing

When `restrict_to_workspace: true`:
- `ExecTool` blocks commands with paths outside the workspace
- File tools restricted to workspace directory
- Path traversal (`../`) blocked

### 8.3 Secret Handling

- No dedicated secret manager integration
- Secrets in config.json (plain text)
- Environment variables as alternative
- `.env` in `.dockerignore` and `.gitignore` prevents accidental commits
- Recommendation: use OS credential managers in production

---

## 9. Cross-Cutting Integration Map

### 9.1 How Components Wire Together in `gateway`

```
gateway command
  |
  +-- load_config() -> Config
  |
  +-- MessageBus() -- event routing
  |
  +-- LiteLLMProvider(api_key, api_base) -- from Config._match_provider()
  |
  +-- AgentLoop(provider, config)
  |     |-- ToolRegistry
  |     |     |-- ExecTool (shell)
  |     |     |-- CronTool (scheduling) <-- wired to CronService
  |     |     |-- ReadFileTool, WriteFileTool, EditFileTool, ListDirTool
  |     |     |-- WebSearchTool, WebFetchTool
  |     |     |-- MessageTool
  |     |     |-- SpawnTool (subagents)
  |     |-- ContextBuilder (system prompt + session history)
  |     +-- SessionManager (conversation persistence)
  |
  +-- ChannelManager
  |     |-- TelegramChannel
  |     |-- DiscordChannel
  |     |-- WhatsAppChannel
  |     +-- FeishuChannel
  |     (all publish InboundMessage to MessageBus)
  |
  +-- CronService(store_path, callback)
  |     callback -> agent processes job payload as a new turn
  |
  +-- HeartbeatService(callback, workspace, interval)
        callback -> agent processes HEARTBEAT.md contents as a new turn
```

### 9.2 Message Flow

```
User (Telegram/Discord/WhatsApp/Feishu)
  --> Channel receives message
    --> Publishes InboundMessage to MessageBus
      --> AgentLoop picks up message
        --> Builds context (system prompt + history + tools)
          --> Calls LiteLLMProvider.chat(messages, tools)
            --> LLM responds (possibly with tool_calls)
              --> AgentLoop executes tools via ToolRegistry
                --> Tool results added to context
                  --> Loop continues until no more tool_calls
                    --> Final response sent back via Channel
```

### 9.3 Scheduled Execution Flow

```
CronService timer fires
  --> callback(job) called
    --> Job payload examined:
      --> "system_event": direct message sent to channel
      --> "agent_turn": full agent loop triggered with job.message as prompt
        --> Agent processes, may use tools, generates response
          --> Response delivered to job.channel:job.chat_id

HeartbeatService interval fires
  --> Reads HEARTBEAT.md
    --> If not empty: callback(file_contents)
      --> Agent processes contents as new turn
        --> May use tools, edit files, send messages
          --> May respond with HEARTBEAT_OK if nothing to do
```

### 9.4 Configuration Propagation

```
~/.nanobot/config.json
  --> load_config() + camelCase->snake_case
    --> Config (Pydantic model)
      --> Config._match_provider(model) -> api_key, api_base
        --> LiteLLMProvider(api_key, api_base)
      --> Config.heartbeat_interval -> HeartbeatService
      --> Config.exec_timeout -> ExecTool
      --> Config.restrict_to_workspace -> ExecTool, FileTool
      --> Config.brave_api_key -> WebSearchTool
      --> Config.{channel}_enabled + tokens -> ChannelManager
      --> Config.allow_from -> Channel auth checks
      --> Config.workspace -> workspace_path for all components
```

---

## Summary of Key Architectural Patterns

1. **Single concrete provider via litellm**: Rather than implementing per-provider classes, nanobot uses litellm as a universal adapter. This trades direct control for massive provider coverage.

2. **Timer-based cron (not polling)**: The cron service uses `asyncio.call_later()` targeting the next due job, rather than polling at fixed intervals. Efficient for sparse schedules.

3. **File-based heartbeat**: A deliberately simple mechanism -- edit a markdown file to control what the agent does periodically. Low-tech but effective for personal use.

4. **camelCase JSON / snake_case Python**: Bidirectional case conversion in the config loader bridges JavaScript-style config files with Python conventions.

5. **Graceful degradation everywhere**: Failed LLM calls return error responses (not exceptions), missing config returns defaults, file read failures are silently logged. The system stays running.

6. **No streaming**: The current architecture is entirely request-response. No streaming support exists in the provider layer.

7. **Single-container Docker**: Both the Python application and Node.js WhatsApp bridge run in one container. Simple but limits scaling.

8. **Best-effort security**: Shell command filtering uses regex patterns (bypassable). Security relies on deployment practices (file permissions, user isolation, allowlists) rather than built-in sandboxing.
