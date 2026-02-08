# FeatherBot Dockerfile — Multi-stage Production Build
#
# Smoke test commands:
#   1. Build:     docker build -t featherbot .
#   2. Start:     docker run --rm -e FEATHERBOT_providers__anthropic__apiKey=test featherbot
#                 (should print "FeatherBot gateway running (headless)")
#   3. Node:      docker run --rm featherbot sh -c "node --version"
#   4. SIGTERM:   docker run -d --name fb-test featherbot && sleep 2 && docker stop fb-test && docker rm fb-test
#                 (should print "Shutting down..." and exit cleanly)

# ── Stage 1: Dependencies ──
FROM node:22-slim AS deps

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/bus/package.json packages/bus/
COPY packages/channels/package.json packages/channels/
COPY packages/scheduler/package.json packages/scheduler/
COPY packages/cli/package.json packages/cli/

# better-sqlite3 requires native build tools
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ──
FROM deps AS build

COPY tsconfig.json biome.json turbo.json ./
COPY packages/ packages/
COPY skills/ skills/
COPY workspace/ workspace/

RUN pnpm build

# ── Stage 3: Runtime ──
FROM node:22-slim AS runtime

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# better-sqlite3 runtime needs libstdc++
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system featherbot && useradd --system --gid featherbot --create-home featherbot

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/bus/package.json packages/bus/
COPY packages/channels/package.json packages/channels/
COPY packages/scheduler/package.json packages/scheduler/
COPY packages/cli/package.json packages/cli/

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/bus/dist packages/bus/dist
COPY --from=build /app/packages/channels/dist packages/channels/dist
COPY --from=build /app/packages/scheduler/dist packages/scheduler/dist
COPY --from=build /app/packages/cli/dist packages/cli/dist
COPY --from=build /app/skills skills
COPY --from=build /app/workspace workspace

RUN mkdir -p /home/featherbot/.featherbot && chown -R featherbot:featherbot /home/featherbot

USER featherbot

ENTRYPOINT ["node", "packages/cli/dist/bin.js"]
CMD ["gateway"]
