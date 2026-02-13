# FeatherBot - Claude Code Instructions

> A personal AI agent framework built with TypeScript.
> See `ARCHITECTURE.md` for full reference architecture.

## Project Context

FeatherBot is a TypeScript personal AI agent that connects to messaging platforms (Telegram, WhatsApp, Discord) and provides an extensible tool/skill system powered by LLMs via the Vercel AI SDK.

**Tech Stack:** Node.js 22, TypeScript, pnpm, Vercel AI SDK, Zod, SQLite (better-sqlite3), grammy, baileys, biome, vitest, tsup, turborepo

## Iterative Build Process

This project uses a structured iterative build process driven by three skills:

| Skill | Purpose |
|-------|---------|
| `/prd` | Generate a PRD for a milestone (asks clarifying questions, writes `tasks/prd-*.md`) |
| `/build-loop` | Convert a PRD into `prd.json` (the structured task queue) |
| `/build` | Pick the next incomplete story, implement it, test it, commit it, update progress |

### Typical Workflow

```
/prd          → create PRD for next milestone
/build-loop   → convert PRD to prd.json
/build        → implement story 1
/build        → implement story 2
...
/build        → milestone complete!
```

### Key Files

| File | Purpose |
|------|---------|
| `prd.json` | Active task queue — stories with completion flags |
| `progress.txt` | Append-only learnings log — patterns, gotchas, context for future work |
| `tasks/prd-*.md` | Human-readable PRDs for each milestone |
| `tasks/ROADMAP.md` | All 20 milestones with dependency graph |
| `ARCHITECTURE.md` | Full reference architecture |

### Quality Requirements

- All code must pass typecheck (`pnpm typecheck`)
- All code must pass lint (`pnpm lint`)
- All tests must pass (`pnpm test`)
- Follow existing patterns in the codebase (check `progress.txt` codebase patterns)
- Keep changes focused and minimal — implement ONLY what the story requires
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
  core/src/          # Agent engine (loop, context, tools, memory, skills, session, provider, config, workspace)
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

## Git Conventions

- Branch naming: `feat/<milestone-name>` (e.g., `feat/m1-project-scaffold`)
- Commit format: `feat: [US-XXX] - Short description`
- One story per commit
- Never force push
- Squash merge to main when milestone complete
