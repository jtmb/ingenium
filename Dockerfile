# Stage 1: Build all monorepo workspaces
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./

# Copy workspace package.json files for dependency install
COPY packages/ingenium-core/package.json ./packages/ingenium-core/
COPY services/ingenium-api/package.json ./services/ingenium-api/
COPY services/ingenium-server/package.json ./services/ingenium-server/
COPY services/ingenium-dashboard/package.json ./services/ingenium-dashboard/
COPY tsconfig.base.json ./

# Install all workspace dependencies
RUN npm ci --workspaces --include-workspace-root

# Copy source and build
COPY . .
RUN npm run build

# Prune dev dependencies for smaller runtime image
RUN npm prune --omit=dev

# Stage 2: Runtime with supervisord + opencode
FROM node:22-alpine AS runtime

ARG OPENCODE_VERSION=1.17.18
RUN apk add --no-cache supervisor curl tzdata python3 make g++
RUN curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64-musl.tar.gz" \
    | tar -xz -C /usr/local/bin/ opencode && chmod +x /usr/local/bin/opencode
RUN addgroup -S appuser && adduser -S appuser -G appuser

WORKDIR /app

# Copy production dependencies (pruned, dev-free)
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules

# Rebuild native addons for this runtime's libc
RUN npm rebuild better-sqlite3 && apk del python3 make g++

# Copy built artifacts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-core/dist ./packages/ingenium-core/dist
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-core/package.json ./packages/ingenium-core/
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-api/dist ./services/ingenium-api/dist
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-api/package.json ./services/ingenium-api/
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-server/dist ./services/ingenium-server/dist
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-server/package.json ./services/ingenium-server/
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-dashboard/.next/standalone ./
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-dashboard/.next/static ./services/ingenium-dashboard/.next/static

# Copy process management config
COPY --chown=appuser:appuser supervisord.conf ./supervisord.conf
COPY --chown=appuser:appuser scripts/docker-entrypoint.sh ./entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create shared config and data directories with proper ownership
RUN mkdir -p /app/config /app/.ingenium /app/.opencode/skills && chown appuser:appuser /app/config /app/.ingenium /app/.opencode /app/.opencode/skills
# Pre-create both the container default and the fallback opencode.json
RUN echo '{"$schema":"https://opencode.ai/config.json","skills":{"paths":[".opencode/skills"]},"mcp":{"playwright":{"type":"local","command":["npx","-y","@playwright/mcp@latest","--caps=vision"],"enabled":true},"ingenium":{"type":"local","command":["node","/app/services/ingenium-server/dist/scripts/mcp-server.js"],"enabled":true,"environment":{"INGENIUM_API_URL":"http://localhost:4097/api/v1","INGENIUM_API_TIMEOUT":"10000","INGENIUM_CORE_DB_PATH":"/app/.ingenium/data"}}},"plugin":[]}' > /app/config/opencode.container.json && \
  cp /app/config/opencode.container.json /app/opencode.json && \
  chown appuser:appuser /app/config/opencode.container.json /app/opencode.json

EXPOSE 3000 4096 4097
USER appuser

ENTRYPOINT ["/app/entrypoint.sh"]
