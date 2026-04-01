# AI Firewall Proxy — Production Dockerfile
#
# Uses bookworm-slim (not alpine) because better-sqlite3 is a native C++ addon.
# Alpine uses musl libc which has documented compatibility issues with native modules.
# Uses tini as PID 1 for proper signal handling (Node.js ignores SIGTERM as PID 1).
#
# Build: docker build -t ai-firewall-proxy .
# Run:   docker run -p 8080:8080 --env-file .env ai-firewall-proxy

# ── Stage 1: Build ──────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy workspace root for npm workspaces
COPY package.json package-lock.json ./

# Copy only packages needed by proxy (scanner is a workspace dep)
COPY packages/scanner/package.json packages/scanner/
COPY proxy/package.json proxy/

# Install all deps (workspaces resolve)
RUN npm ci --ignore-scripts && \
    cd packages/scanner && npm run build || true

# Copy source
COPY packages/scanner/ packages/scanner/
COPY proxy/ proxy/

# Build scanner package first, then proxy
RUN cd packages/scanner && npm run build && \
    cd /app/proxy && npm run build

# ── Stage 2: Runtime ────────────────────────────────────────────────────────

FROM node:22-bookworm-slim

# Install tini for proper PID 1 signal handling
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

# Non-root user (security best practice)
USER node
WORKDIR /app

# Copy built artifacts
COPY --from=builder --chown=node:node /app/proxy/dist ./proxy/dist
COPY --from=builder --chown=node:node /app/packages/scanner/dist ./packages/scanner/dist
COPY --from=builder --chown=node:node /app/packages/scanner/package.json ./packages/scanner/
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/proxy/node_modules ./proxy/node_modules
COPY --chown=node:node proxy/package.json proxy/policy.json ./proxy/
COPY --chown=node:node proxy/.env.example ./proxy/.env.example

# Create data directory for SQLite
RUN mkdir -p /app/proxy/data

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

# tini as PID 1 — handles SIGTERM/SIGINT properly
ENTRYPOINT ["tini", "--"]
CMD ["node", "proxy/dist/server.js"]

# Health check using built-in fetch (no curl needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)throw r}).catch(()=>process.exit(1))"
