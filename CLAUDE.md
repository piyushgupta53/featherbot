# FeatherBot - Claude Code Instructions

> TypeScript reimplementation of nanobot (HKUDS) as a personal AI agent framework.
> See `ARCHITECTURE.md` for full reference architecture.

## Project Context

FeatherBot is a TypeScript personal AI agent that connects to messaging platforms (Telegram, WhatsApp, Discord) and provides an extensible tool/skill system powered by LLMs via the Vercel AI SDK.

**Tech Stack:** Node.js 22, TypeScript, pnpm, Vercel AI SDK, Zod, SQLite (better-sqlite3), grammy, baileys, biome, vitest, tsup, turborepo

## Iterative Build Process

This project uses a structured iterative build process. When working autonomously (via `build.sh`), follow this exact sequence:

### Per-Iteration Steps

1. **Read context** - Read `prd.json` and `progress.txt` to understand current state
2. **Check branch** - Verify you're on the correct git branch (from `prd.json.branchName`). If not, create it from `main`
3. **Select story** - Pick the highest-priority incomplete story (`passes: false`) from `prd.json`
4. **Implement** - Complete ONLY that single story. Do not work on multiple stories
5. **Quality checks** - Run: `pnpm typecheck && pnpm lint && pnpm test` (all must pass)
6. **Update patterns** - If you discover codebase patterns, update the relevant `AGENTS.md` file in the directory you worked in
7. **Commit** - `git add -A && git commit -m "feat: [US-XXX] - [Story Title]"`
8. **Mark complete** - Set `passes: true` for the story in `prd.json`
9. **Log progress** - Append entry to `progress.txt` with:
   - Story ID and title
   - Files modified
   - Learnings for future iterations
10. **Check completion** - If ALL stories have `passes: true`, respond with `<promise>COMPLETE</promise>`

### Quality Requirements

- All code must pass typecheck (`tsc --noEmit`)
- All code must pass lint (`biome check`)
- All tests must pass (`vitest run`)
- Follow existing patterns in the codebase
- Keep changes focused and minimal - implement ONLY what the story requires
- Do not refactor unrelated code

## Code Conventions

### TypeScript
- Strict mode enabled
- Use `interface` over `type` for object shapes
- Use Zod for runtime validation and type inference (`z.infer<typeof schema>`)
- Prefer `async/await` over raw promises
- Use named exports, no default exports
- File naming: `kebab-case.ts`

### Project Structure
```
packages/
  core/src/          # Agent engine (loop, context, tools, memory, skills, session, provider, config)
  channels/src/      # Channel implementations (base, manager, telegram, whatsapp, discord, terminal)
  bus/src/           # Message bus (bus, types)
  scheduler/src/     # Cron + heartbeat
  cli/src/           # CLI commands
skills/              # Bundled SKILL.md plugins
workspace/           # Default workspace template
```

### Dependencies (use these, not alternatives)
- LLM: `ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai` (Vercel AI SDK)
- Config: `zod` + `dotenv`
- CLI: `commander`
- Telegram: `grammy`
- WhatsApp: `@whiskeysockets/baileys`
- Scheduling: `croner`
- Logging: `pino`
- Storage: `better-sqlite3` + `drizzle-orm`
- HTTP: native `fetch`
- Testing: `vitest`
- Linting: `@biomejs/biome`
- Build: `tsup`
- Monorepo: `turbo`

### Error Handling
- Tools always return strings (never throw to LLM)
- Use Result pattern for internal errors where appropriate
- Graceful degradation: log error, return fallback, never crash

### Testing
- Co-locate test files: `foo.ts` -> `foo.test.ts`
- Use vitest
- Test tool execution, not just schemas
- Mock LLM calls in agent loop tests

## Files You Should Know

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | Complete reference architecture (nanobot analysis + FeatherBot design) |
| `prd.json` | Current active task queue with user stories |
| `progress.txt` | Append-only learnings and patterns from previous iterations |
| `tasks/prd-*.md` | Human-readable PRDs for each milestone |
| `analysis-*.md` | Detailed nanobot analysis files (reference only) |

## Git Conventions

- Branch naming: `feat/<milestone-name>` (e.g., `feat/core-config`)
- Commit format: `feat: [US-XXX] - Short description`
- One story per commit
- Never force push
- Squash merge to main when milestone complete
