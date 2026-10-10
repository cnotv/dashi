FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/runner/package.json apps/runner/
COPY apps/cli/package.json apps/cli/
COPY apps/opencode-plugin/package.json apps/opencode-plugin/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @dashi/web build

# Reinstall with production dependencies of the server only, so the runtime image carries
# no build tooling.
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && pnpm install --prod --frozen-lockfile --filter @dashi/server...

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4317 \
    DASHI_HOST=0.0.0.0 \
    DASHI_PUBLISHED_ON_LOOPBACK=1 \
    DASHI_DATA_DIR=/data

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/config ./config
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
# Served to laptops from /api/runner/script; the server never runs it.
COPY --from=build /app/apps/runner/src/runner.ts ./apps/runner/src/runner.ts
# Served to machines from /api/cli/script; the server never runs it either.
COPY --from=build /app/apps/cli/src/dashi.ts ./apps/cli/src/dashi.ts
# Served to machines from /api/cli/opencode-reporter, for OpenCode to load; the server never runs it.
COPY --from=build /app/apps/opencode-plugin/src/opencode-reporter.ts ./apps/opencode-plugin/src/opencode-reporter.ts

# 1000 is the image's `node` user; a numeric id resolves the same on every host.
RUN mkdir -p /data && chown 1000:1000 /data
USER 1000:1000
VOLUME ["/data"]
EXPOSE 4317
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/ops/healthcheck.ts"]
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/main.ts"]
