<p align="center">
  <img src="assets/featherbot.png" alt="FeatherBot" width="500" />
</p>

<h1 align="center">featherbot: Personal AI Agent</h1>

<p align="center">
  A lightweight personal AI agent. Connects to messaging platforms (Telegram, WhatsApp) and provides an extensible tool/skill system powered by LLMs.
</p>

---

## Features

- **Multi-provider LLM support** — Anthropic (Claude), OpenAI (GPT), OpenRouter via Vercel AI SDK
- **Messaging channels** — Telegram, WhatsApp, terminal REPL
- **Tool system** — File I/O, shell execution, web search/fetch, cron scheduling, sub-agent spawning
- **Skills** — Markdown-driven plugins with two-tier loading (always-on + lazy-loaded)
- **Sub-agents** — Spawn background tasks with isolated tool sets and timeouts
- **Memory** — Persistent file-based memory with automatic extraction, daily note rollup, and size-aware context management
- **Session management** — SQLite-backed conversation history with message trimming
- **Cron & heartbeat** — Scheduled tasks, one-time reminders, and periodic self-reflection
- **Voice transcription** — Groq or OpenAI Whisper for voice messages in Telegram/WhatsApp
- **Message batching** — Per-session debounce and serialization to prevent race conditions and reduce LLM costs
- **Context builder** — 5-layer system prompt (identity, bootstrap files, memory, skills, session)
- **Docker support** — Multi-stage build, docker-compose, headless mode

## Prerequisites

- Node.js >= 20
- pnpm >= 9

## Quick Start

```bash
# Clone and install
git clone https://github.com/piyushgpta/featherbot.git
cd featherbot
pnpm install

# Build all packages
pnpm build

# Run setup wizard (creates ~/.featherbot/config.json)
pnpm start
```

The onboard wizard will:

1. Ask for your API key (auto-detects provider from key prefix)
2. Let you choose a model
3. Optionally enable Telegram and WhatsApp channels
4. Optionally enable voice transcription (Groq or OpenAI Whisper)
5. Optionally configure web search (Brave API key)

Configuration is saved to `~/.featherbot/config.json`.

## Commands

After building, you can run commands via npm scripts (e.g. `pnpm start`), or install the CLI globally:

```bash
pnpm --filter @featherbot/cli link --global
```

This makes `featherbot` and `fb` available system-wide:

| Command | Description |
|---------|-------------|
| `featherbot` / `fb` | Smart start — runs onboard if needed, then starts agent |
| `featherbot start` | Same as bare `featherbot` |
| `featherbot onboard` | Interactive setup wizard |
| `featherbot agent` | Start the REPL |
| `featherbot agent -m "message"` | Single-shot mode |
| `featherbot gateway` | Start with all enabled channels + cron + heartbeat |
| `featherbot status` | Show current configuration |
| `featherbot whatsapp login` | Pair your WhatsApp device |

## Channels

### Terminal

Interactive REPL with `you>` / `bot>` prompts. The default channel when running `featherbot agent`.

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Run `featherbot onboard` and enable Telegram when prompted
3. Paste your bot token
4. (Optional) Add allowed usernames for access control
5. Start with `featherbot gateway`

Supports MarkdownV2 formatting, media (photos, voice, audio, documents), voice transcription, and reply threading.

### WhatsApp

1. Run `featherbot onboard` and enable WhatsApp when prompted
2. Run `featherbot whatsapp login` to pair via QR code
3. Scan with WhatsApp on your phone
4. Start with `featherbot gateway`

Direct Baileys integration (no external bridge). Supports all message types, auto-reconnect, and persistent auth state.

## Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write/create files (auto-creates parent directories) |
| `edit_file` | Find-and-replace editing with ambiguity rejection |
| `list_dir` | List directory contents |
| `exec` | Shell command execution (60s timeout, deny-list enforced) |
| `web_search` | Search the web via Brave Search API |
| `web_fetch` | Fetch and extract readable content from URLs |
| `cron` | Manage scheduled tasks (add/list/remove/enable/disable) |
| `recall_recent` | Retrieve past daily notes (last N days) on demand |
| `spawn` | Spawn sub-agents for background tasks |

All tools return strings and never throw errors to the LLM.

## Skills

Skills are markdown-driven plugins loaded from the workspace. FeatherBot uses a two-tier system to prevent prompt bloat:

- **Always-loaded** — Full SKILL.md injected into every prompt
- **Available** — XML summary only; the agent lazy-loads via `read_file` when needed

### Bundled Skills

| Skill | Description |
|-------|-------------|
| `weather` | Weather lookup via wttr.in |
| `cron` | Schedule reminders and recurring tasks |
| `heartbeat` | Proactive behavior and periodic self-reflection |
| `skill-creator` | Meta-skill for creating new skills |
| `hn-ai-digest` | Hacker News AI digest |

Custom skills can be added to `~/.featherbot/workspace/skills/` or per-workspace in `skills/`.

## Message Batching

When a user sends multiple messages in quick succession (e.g. "check my calendar" / "actually wait" / "check tomorrow not today"), FeatherBot batches them into a single LLM call instead of firing three independent requests. This prevents race conditions on shared conversation history, reduces API costs, and produces one coherent response.

- **Debounce** — 2-second window (configurable) resets on each new message
- **Serialize** — Only one LLM call per session at a time; messages arriving during processing queue for the next batch
- **Batch** — Queued messages are merged (content joined with `\n`, media deduplicated, metadata combined)

## Sub-agents

Spawn background tasks with isolated tool sets (no message, spawn, or cron tools to prevent recursion). Sub-agents have configurable max iterations (default: 15) and timeout (default: 5 minutes). Results are routed back to the originating channel.

## Memory

File-based storage in `workspace/memory/`, managed by the agent via file tools:

| File | Purpose |
|------|---------|
| `MEMORY.md` | Long-term memory (Facts, Observed Patterns, Pending) |
| `YYYY-MM-DD.md` | Daily notes (transient, per-day context) |

**Daily note rollup** — Yesterday's notes are surfaced automatically. The agent promotes important items into long-term memory and discards the rest, so daily notes don't rot.

**Size guard** — When MEMORY.md grows large (~2000+ tokens), the agent is nudged to consolidate and prune stale entries.

**Automatic extraction** — After a conversation goes idle (default: 5 minutes), a background pass reviews the conversation and persists any new user facts, preferences, or patterns to `MEMORY.md` automatically — no need for the user to say "remember this."

**On-demand recall** — The `recall_recent` tool lets the agent pull past daily notes (up to 30 days) without bloating every prompt.

No vector store or embeddings — just markdown files with a lifecycle.

## Cron & Heartbeat

### Cron Scheduler

Timer-based firing (single setTimeout to next deadline). Supports three schedule types:

- **Cron expressions** — `0 9 * * *` (every day at 9am)
- **Fixed intervals** — `everySeconds: 3600` (every hour)
- **One-time reminders** — `at: "2026-02-10T14:45:00"` or `relativeMinutes: 30`

Jobs persist to `~/.featherbot/cron.json` and fire back into the originating channel.

### Heartbeat

Periodic wake-up (default: every 10 minutes) that reads `HEARTBEAT.md` from the workspace. Enables proactive agent behavior: reviewing memory, checking pending follow-ups, and autonomously deciding whether to message the user. The agent writes to `HEARTBEAT.md` itself during conversations when it detects something that needs periodic attention.

When `notifyChannel` and `notifyChatId` are configured, heartbeat results are delivered as messages to the user (e.g., via Telegram or WhatsApp) instead of being silently discarded.

## Voice Transcription

Opt-in transcription of voice messages in Telegram and WhatsApp:

- **Providers:** Groq (`whisper-large-v3-turbo`) or OpenAI (`whisper-1`)
- **Max duration:** 120 seconds (configurable)
- Enable via `featherbot onboard` or set `FEATHERBOT_transcription__enabled=true`

## Configuration

Primary config file: `~/.featherbot/config.json` (created by the onboard wizard).

Environment variables override any config value using the `FEATHERBOT_` prefix with `__` as the path delimiter:

```bash
FEATHERBOT_providers__anthropic__apiKey=sk-ant-...
FEATHERBOT_channels__telegram__enabled=true
FEATHERBOT_transcription__enabled=true
```

See [`.env.example`](.env.example) for all available environment variables.

## Docker

```bash
# Build
docker build -t featherbot .

# Run with docker-compose
cp .env.example .env
# Edit .env with your API keys
docker compose up
```

The Docker setup includes:

- Multi-stage build based on `node:22-slim`
- Non-root `featherbot` user
- Named volume for persistent data (`/home/featherbot/.featherbot`)
- Headless mode (automatically skips terminal channel)
- Graceful SIGTERM handling

## Workspace

The default workspace is created at `~/.featherbot/workspace/` on first run:

```
workspace/
├── AGENTS.md       # Agent behavior rules and tool usage guidelines
├── SOUL.md         # Personality definition
├── USER.md         # User profile (name, timezone, preferences)
├── TOOLS.md        # Tool documentation
├── HEARTBEAT.md    # Periodic tasks and proactive review instructions
└── memory/
    ├── MEMORY.md       # Long-term memory
    └── YYYY-MM-DD.md   # Daily notes (auto-created)
```

Edit these files to customize your agent's personality, behavior, and proactive capabilities.

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (682 tests)
pnpm typecheck        # Type checking
pnpm lint             # Lint with Biome
```

## License

MIT
