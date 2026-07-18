# Stage 1: Build all monorepo workspaces
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./

# Copy workspace package.json files for dependency install
COPY packages/ingenium-core/package.json ./packages/ingenium-core/
COPY packages/ingenium-email/package.json ./packages/ingenium-email/
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
FROM node:22-slim AS runtime

ARG OPENCODE_VERSION=1.18.3
RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor curl ca-certificates tzdata python3 make g++ git sudo && \
    rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/opencode.tar.gz "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" && \
    tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin/ opencode && \
    chmod +x /usr/local/bin/opencode && \
    rm /tmp/opencode.tar.gz
RUN curl -fsSL -o /tmp/ttyd.x86_64 "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64" && \
    echo "8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55  /tmp/ttyd.x86_64" | sha256sum -c - && \
    mv /tmp/ttyd.x86_64 /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd && \
    ttyd --version && \
    rm /tmp/ttyd.x86_64 2>/dev/null || true
RUN userdel -r node && adduser --uid 1000 --disabled-password --comment "" appuser && \
    adduser appuser sudo && \
    echo "appuser ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/appuser && \
    chmod 0440 /etc/sudoers.d/appuser

WORKDIR /app

# Copy production dependencies (pruned, dev-free)
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules

# Rebuild native addons for this runtime's libc (glibc now, no need to remove build tools)

# Copy built artifacts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-core/dist ./packages/ingenium-core/dist
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-core/package.json ./packages/ingenium-core/
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-email/dist ./packages/ingenium-email/dist
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-email/package.json ./packages/ingenium-email/
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-api/dist ./services/ingenium-api/dist
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-api/package.json ./services/ingenium-api/
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-server/dist ./services/ingenium-server/dist
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-server/package.json ./services/ingenium-server/
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-dashboard/.next/standalone ./
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-dashboard/.next/static ./services/ingenium-dashboard/.next/static
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/ ./packages/ingenium-extension/

# Copy process management config
COPY --chown=appuser:appuser supervisord.conf ./supervisord.conf
COPY --chown=appuser:appuser scripts/docker-entrypoint.sh ./entrypoint.sh
# Copy agent definitions, commands, and skills (excluded from .dockerignore)
COPY --chown=appuser:appuser .opencode/agents ./.opencode/agents
COPY --chown=appuser:appuser .opencode/commands ./.opencode/commands
COPY --chown=appuser:appuser .opencode/skills ./.opencode/skills
# Copy database migrations (needed for incremental DB upgrades)
COPY packages/ingenium-core/data/migrations/ /app/packages/ingenium-core/data/migrations/
RUN chmod +x /app/entrypoint.sh

# Create shared config and data directories with proper ownership
RUN mkdir -p /app/config /app/.ingenium/logs /app/.opencode/skills /workspace && chown -R appuser:appuser /app/config /app/.ingenium /app/.opencode /app/.opencode/skills /workspace
# Pre-create appuser home for OpenCode config persistence
RUN mkdir -p /home/appuser/.config/opencode /home/appuser/.local/share/opencode/log && chown -R appuser:appuser /home/appuser
# Pre-create both the container default and the fallback opencode.json
RUN echo '{"$schema":"https://opencode.ai/config.json","skills":{"paths":[".opencode/skills"]},"mcp":{"playwright":{"type":"local","command":["npx","-y","@playwright/mcp@latest","--caps=vision"],"enabled":true},"ingenium":{"type":"local","command":["node","/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],"enabled":true,"environment":{"INGENIUM_API_URL":"http://localhost:4097/api/v1","INGENIUM_API_TIMEOUT":"10000","INGENIUM_CORE_DB_PATH":"/app/.ingenium/data"}}},"plugin":[]}' > /app/config/opencode.container.json && \
  cp /app/config/opencode.container.json /app/opencode.json && \
  chown appuser:appuser /app/config/opencode.container.json /app/opencode.json

EXPOSE 3000 4097 4098 4099 1455

ENTRYPOINT ["/app/entrypoint.sh"]
