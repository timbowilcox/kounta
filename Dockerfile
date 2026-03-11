# ---------------------------------------------------------------------------
# Ledge — self-hosted single-container image
#
# Bundles the REST API with embedded SQLite (sql.js WASM).
# Start with:   docker run -p 3001:3001 getledge/ledge
# Persist data:  docker run -p 3001:3001 -v ledge-data:/data getledge/ledge
# ---------------------------------------------------------------------------

# ---- Stage 1: Install & Build -------------------------------------------------
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

WORKDIR /build

# Copy workspace config first (cacheable layer)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./

# Copy only the packages needed for the API (core + api)
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/api/package.json  packages/api/tsconfig.json  packages/api/

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile --filter=@ledge/core --filter=@ledge/api

# Copy source files
COPY packages/core/src packages/core/src
COPY packages/api/src  packages/api/src

# Build core first, then api (dependency order)
RUN pnpm --filter=@ledge/core build && pnpm --filter=@ledge/api build

# ---- Stage 2: Prune to production deps only -----------------------------------
FROM node:20-slim AS pruner

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

WORKDIR /app

COPY --from=builder /build/package.json /build/pnpm-workspace.yaml /build/pnpm-lock.yaml ./
COPY --from=builder /build/packages/core/package.json packages/core/
COPY --from=builder /build/packages/api/package.json  packages/api/

RUN pnpm install --frozen-lockfile --prod --filter=@ledge/core --filter=@ledge/api

# ---- Stage 3: Runtime ----------------------------------------------------------
FROM node:20-slim AS runtime

LABEL org.opencontainers.image.title="Ledge" \
      org.opencontainers.image.description="Double-entry ledger API with embedded SQLite" \
      org.opencontainers.image.vendor="getledge" \
      org.opencontainers.image.url="https://getledge.dev"

# Create non-root user
RUN groupadd --gid 1001 ledge && \
    useradd  --uid 1001 --gid ledge --shell /bin/false --create-home ledge

WORKDIR /app

# Copy production node_modules
COPY --from=pruner /app/node_modules            node_modules
COPY --from=pruner /app/packages/core/node_modules packages/core/node_modules
COPY --from=pruner /app/packages/api/node_modules  packages/api/node_modules

# Copy compiled output
COPY --from=builder /build/packages/core/dist    packages/core/dist
COPY --from=builder /build/packages/core/package.json packages/core/
COPY --from=builder /build/packages/api/dist     packages/api/dist
COPY --from=builder /build/packages/api/package.json  packages/api/

# Copy migration SQL (applied at boot)
COPY packages/core/src/db/migrations packages/core/migrations

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Data directory for persistent SQLite storage
RUN mkdir -p /data && chown ledge:ledge /data

USER ledge

ENV NODE_ENV=production \
    PORT=3001 \
    LEDGE_DATA_DIR=/data \
    LEDGE_ADMIN_SECRET=""

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/v1/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "packages/api/dist/index.js"]
