# FeatherBot Milestone Roadmap

Derived from ARCHITECTURE.md Section 18 (Implementation Order).
Each milestone gets its own PRD in `tasks/prd-<milestone>.md`.

## Phase 1: Foundation

| # | Milestone | Stories | Status | Branch |
|---|-----------|---------|--------|--------|
| M1 | Project Scaffold & Config | 7 | Active | `feat/m1-project-scaffold` |
| M2 | LLM Provider (Vercel AI SDK) | ~5 | Planned | `feat/m2-llm-provider` |
| M3 | Tool System (Registry + Shell + Filesystem) | ~7 | Planned | `feat/m3-tool-system` |
| M4 | Agent Loop (ReAct via generateText) | ~6 | Planned | `feat/m4-agent-loop` |

## Phase 2: Memory & Context

| # | Milestone | Stories | Status | Branch |
|---|-----------|---------|--------|--------|
| M5 | Memory System (File-based) | ~4 | Planned | `feat/m5-memory` |
| M6 | Context Builder (System prompt assembly) | ~5 | Planned | `feat/m6-context-builder` |
| M7 | Session Management (SQLite) | ~5 | Planned | `feat/m7-sessions` |

## Phase 3: Communication

| # | Milestone | Stories | Status | Branch |
|---|-----------|---------|--------|--------|
| M8 | Message Bus (Typed event bus) | ~4 | Planned | `feat/m8-message-bus` |
| M9 | Terminal Channel (First E2E test) | ~4 | Planned | `feat/m9-terminal-channel` |
| M10 | CLI Commands (onboard, agent, status, gateway) | ~6 | Planned | `feat/m10-cli` |

## Phase 4: Skills & Scheduling

| # | Milestone | Stories | Status | Branch |
|---|-----------|---------|--------|--------|
| M11 | Skills System (Filesystem-based loading) | ~5 | Planned | `feat/m11-skills` |
| M12 | Cron Scheduler (croner-based) | ~4 | Planned | `feat/m12-cron` |
| M13 | Heartbeat Service | ~3 | Planned | `feat/m13-heartbeat` |

## Phase 5: Channels

| # | Milestone | Stories | Status | Branch |
|---|-----------|---------|--------|--------|
| M14 | Telegram Channel (grammy) | ~5 | Planned | `feat/m14-telegram` |
| M15 | WhatsApp Channel (baileys) | ~5 | Planned | `feat/m15-whatsapp` |
| M16 | Discord Channel | ~4 | Planned | `feat/m16-discord` |

## Phase 6: Advanced

| # | Milestone | Stories | Status | Branch |
|---|-----------|---------|--------|--------|
| M17 | Sub-agents (Async background tasks) | ~4 | Planned | `feat/m17-subagents` |
| M18 | Web Search Tool (Brave/Tavily) | ~3 | Planned | `feat/m18-web-tools` |
| M19 | Gateway (Unified startup) | ~4 | Planned | `feat/m19-gateway` |
| M20 | Docker + Deployment | ~3 | Planned | `feat/m20-docker` |

## Workflow

1. When starting a milestone, run `/prd` to generate its PRD
2. Run `/build-loop` to convert PRD to `prd.json`
3. Run `./build.sh 15` to execute the build loop
4. Review results, merge to main
5. Move to next milestone

## Dependency Graph

```
M1 (Scaffold) ──> M2 (LLM) ──> M4 (Agent Loop) ──> M9 (Terminal) ──> M10 (CLI)
      │                              │                                     │
      ├──> M3 (Tools) ──────────────┘                                     │
      │                                                                    │
      ├──> M5 (Memory) ──> M6 (Context) ──> M4                           │
      │                                                                    │
      ├──> M7 (Sessions) ──> M4                                           │
      │                                                                    │
      ├──> M8 (Bus) ──> M9                                                │
      │                                                                    │
      ├──> M11 (Skills) ──> M6                                            │
      │                                                                    │
      └──> M12 (Cron) ──> M19 (Gateway)                                   │
           M13 (Heartbeat) ──> M19                                         │
           M14 (Telegram) ──> M19                                          │
           M15 (WhatsApp) ──> M19                                          │
           M16 (Discord) ──> M19                                           │
           M17 (Sub-agents) ──> M19                                        │
           M18 (Web Tools) ──> M3                                          │
           M19 (Gateway) ──> M20 (Docker)                                  │
```
