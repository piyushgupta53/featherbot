# PRD: M1 - Project Scaffold & Config

## Problem Statement

FeatherBot has no code yet. We need the foundational monorepo structure, build tooling, and configuration system before any features can be implemented.

## Goals

1. Set up a pnpm monorepo with turborepo
2. Create all package directories with proper TypeScript configs
3. Implement the Zod-based configuration system (schemas + loader)
4. Establish shared types used across packages
5. Set up biome for linting, vitest for testing, tsup for building

## Non-Goals

- No LLM integration yet
- No agent loop
- No channels
- No tools beyond config

## Reference

- ARCHITECTURE.md Section 14 (Configuration)
- ARCHITECTURE.md Section 18 (FeatherBot TypeScript Architecture)
- analysis-infra.md (Config section)

## User Stories

### US-001: Monorepo Initialization

**As a** developer setting up FeatherBot
**I want** a properly configured pnpm monorepo with turborepo
**So that** all packages can be developed, built, and tested independently

**Acceptance Criteria:**
- [ ] Root `package.json` with workspace config
- [ ] `pnpm-workspace.yaml` listing all packages
- [ ] `turbo.json` with build, test, typecheck, lint pipelines
- [ ] `biome.json` with TypeScript rules (single quotes, tabs or 2-space indent, trailing commas)
- [ ] Root `tsconfig.json` base config (strict, ESM, Node22 target)
- [ ] `.gitignore` covering node_modules, dist, .env, prd.json, progress.txt, .last-branch, archive/
- [ ] `pnpm install` succeeds with no errors

### US-002: Core Package Setup

**As a** developer
**I want** the `packages/core` package initialized with proper structure
**So that** the agent engine has a home

**Acceptance Criteria:**
- [ ] `packages/core/package.json` with name `@featherbot/core`
- [ ] `packages/core/tsconfig.json` extending root config
- [ ] `packages/core/src/index.ts` with placeholder export
- [ ] Directory stubs: `agent/`, `memory/`, `tools/`, `skills/`, `session/`, `provider/`, `config/`
- [ ] `pnpm typecheck` passes for core package

### US-003: Supporting Package Stubs

**As a** developer
**I want** all other packages initialized with minimal setup
**So that** cross-package dependencies can be declared from the start

**Acceptance Criteria:**
- [ ] `packages/channels/package.json` (`@featherbot/channels`)
- [ ] `packages/bus/package.json` (`@featherbot/bus`)
- [ ] `packages/scheduler/package.json` (`@featherbot/scheduler`)
- [ ] `packages/cli/package.json` (`@featherbot/cli`)
- [ ] Each has `tsconfig.json` extending root, `src/index.ts` placeholder
- [ ] `pnpm typecheck` passes for all packages

### US-004: Zod Config Schemas

**As a** developer
**I want** Zod schemas defining all FeatherBot configuration
**So that** config is validated at runtime with full type inference

**Acceptance Criteria:**
- [ ] `packages/core/src/config/schema.ts` with schemas for:
  - `AgentConfig` (model, maxTokens, temperature, maxToolIterations, workspace path)
  - `ChannelConfig` (per-channel: enabled, token/credentials, allowFrom)
  - `ProviderConfig` (per-provider: apiKey)
  - `ToolConfig` (exec timeout, web search key, restrictToWorkspace)
  - `FeatherBotConfig` (root: agents, channels, providers, tools)
- [ ] All schemas use Zod with sensible defaults matching ARCHITECTURE.md Section 14
- [ ] Types exported via `z.infer<>`
- [ ] Typecheck passes

### US-005: Config Loader

**As a** developer
**I want** a config loader that reads from file + environment variables
**So that** FeatherBot can be configured flexibly

**Acceptance Criteria:**
- [ ] `packages/core/src/config/loader.ts` implementing:
  - Load from `~/.featherbot/config.json` (or custom path via `FEATHERBOT_CONFIG` env var)
  - Environment variable overrides with `FEATHERBOT_` prefix
  - Nested env vars using `__` delimiter (e.g., `FEATHERBOT_AGENTS__MODEL`)
  - Returns validated `FeatherBotConfig` (Zod parse with defaults)
  - Graceful handling: invalid config logs warning, uses defaults (never crash)
- [ ] `packages/core/src/config/index.ts` re-exports schema types + loader
- [ ] Unit tests in `packages/core/src/config/loader.test.ts`
- [ ] Typecheck passes
- [ ] Tests pass

### US-006: Shared Types

**As a** developer
**I want** shared type definitions used across packages
**So that** packages have a common vocabulary

**Acceptance Criteria:**
- [ ] `packages/core/src/types.ts` with:
  - `InboundMessage` interface (channel, senderId, chatId, content, timestamp, media, metadata, sessionKey getter)
  - `OutboundMessage` interface (channel, chatId, content, replyTo, media, metadata)
  - `ToolDefinition` interface (name, description, parameters schema)
  - `ToolResult` type (string)
  - `LLMResponse` interface (content, toolCalls, finishReason, usage)
  - `SessionKey` type (template literal `${string}:${string}`)
- [ ] Types exported from `packages/core/src/index.ts`
- [ ] Typecheck passes

### US-007: Vitest + Biome Verification

**As a** developer
**I want** the test and lint pipelines working end-to-end
**So that** quality gates are operational for the build loop

**Acceptance Criteria:**
- [ ] `vitest.config.ts` at root (or per-package) configured for TypeScript
- [ ] `pnpm test` runs all tests across packages
- [ ] `pnpm lint` runs biome check across packages
- [ ] `pnpm typecheck` runs tsc --noEmit across packages
- [ ] All three commands pass with current code
- [ ] At least one real test exists (config loader test from US-005)

## Dependencies

- None (this is the first milestone)

## Technical Notes

- Use ESM throughout (`"type": "module"` in all package.json)
- Target Node.js 22 LTS
- Use `tsup` for building (but building is not required for dev - use `tsx` for running)
- Config file uses camelCase (JavaScript convention, matching ARCHITECTURE.md)
- Environment overrides: `FEATHERBOT_AGENTS__MODEL=anthropic/claude-sonnet-4-5` -> `config.agents.model`
