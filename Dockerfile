# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---- build: install deps, compile web + api ----
FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @free-wan/web build \
    && pnpm --filter @free-wan/api build

# ---- runtime: ffmpeg + the built app ----
FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
COPY --from=build /app /app
# Least privilege (security §5/§9): run as the non-root `node` user. Data dir is owned by it;
# a bind-mounted ./data on the host should be chowned to uid 1000 (the node user).
RUN mkdir -p /app/data && chown -R node:node /app/data /app/packages
USER node
WORKDIR /app/packages/api
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
