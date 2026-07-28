# Stage 1: Build all monorepo workspaces. Keep this glibc-based image aligned
# with runtime: native Node modules compiled or selected here are copied there.
FROM node:22-slim AS builder
WORKDIR /app

# Native modules such as better-sqlite3 can fall back to node-gyp when a
# prebuilt binary is unavailable. These build-only tools never enter runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy workspace root config
COPY package.json package-lock.json ./

# Copy workspace package.json files for dependency install
COPY packages/ingenium-core/package.json ./packages/ingenium-core/
COPY packages/ingenium-email/package.json ./packages/ingenium-email/
COPY packages/ingenium-extension/package.json ./packages/ingenium-extension/
COPY services/ingenium-api/package.json ./services/ingenium-api/
COPY services/ingenium-server/package.json ./services/ingenium-server/
COPY services/ingenium-dashboard/package.json ./services/ingenium-dashboard/
COPY tsconfig.base.json ./

# Install all workspace dependencies
RUN npm ci --workspaces --include-workspace-root

# Copy source and build
COPY . .
RUN sh scripts/validate-deployment-config.sh
# These values are intentionally public browser configuration. They must be
# present before the Next.js build because NEXT_PUBLIC_* values are inlined into
# the dashboard bundle; setting them only on the running container is too late.
# The default uses the two local loopback gateway origins, never the
# private OpenCode/ttyd listeners.
ARG NEXT_PUBLIC_OPENCODE_WEB_URL="http://opencode.localhost:3000/"
ARG NEXT_PUBLIC_OPENCODE_CLI_URL="http://cli.localhost:3000/"
ENV NEXT_PUBLIC_OPENCODE_WEB_URL=${NEXT_PUBLIC_OPENCODE_WEB_URL}
ENV NEXT_PUBLIC_OPENCODE_CLI_URL=${NEXT_PUBLIC_OPENCODE_CLI_URL}
RUN npm run build

# Prune dev dependencies for smaller runtime image
RUN npm prune --omit=dev

# Stage 2: Runtime with supervisord + opencode
FROM node:22-slim AS runtime

# These public OCI metadata values are supplied by the deployment command.
# Keep provenance as build arguments rather than deriving it from .git, which
# is intentionally excluded from the Docker build context.
ARG IMAGE_REVISION
ARG IMAGE_SOURCE="https://github.com/jtmb/ingenium"
RUN printf '%s' "$IMAGE_REVISION" | grep -Eq '^[0-9a-f]{40}$' && \
    case "$IMAGE_SOURCE" in https://*/*) ;; *) exit 1 ;; esac && \
    case "$IMAGE_SOURCE" in *"@"*|*"?"*|*"#"*) exit 1 ;; esac
LABEL org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.source="${IMAGE_SOURCE}"

ARG OPENCODE_VERSION=1.18.3
ARG OPENCODE_SHA256=60f27b2679f00a511b6539f97e02448afaf58d9c66e2448285ea0c517ca84583
RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor nginx curl ca-certificates tzdata git && \
    rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/opencode.tar.gz "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" && \
    echo "${OPENCODE_SHA256}  /tmp/opencode.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin/ opencode && \
    chmod +x /usr/local/bin/opencode && \
    rm /tmp/opencode.tar.gz
RUN curl -fsSL -o /tmp/ttyd.x86_64 "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64" && \
    echo "8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55  /tmp/ttyd.x86_64" | sha256sum -c - && \
    mv /tmp/ttyd.x86_64 /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd && \
    ttyd --version && \
    rm /tmp/ttyd.x86_64 2>/dev/null || true
RUN userdel -r node && adduser --uid 1000 --disabled-password --comment "" appuser

WORKDIR /app

# Copy production dependencies (pruned, dev-free)
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
# Fail the image build if the copied native binding cannot load on the runtime
# libc. This protects the API from a delayed better-sqlite3 startup failure.
RUN node -e 'require("better-sqlite3")'

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
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-dashboard/public ./services/ingenium-dashboard/public
COPY --from=builder --chown=appuser:appuser /app/services/ingenium-dashboard/.next/static ./services/ingenium-dashboard/.next/static
# The init CLI is an independently documented runtime command. Copy only the
# package distribution and expose it via a stable PATH location rather than
# relying on a workspace node_modules/.bin symlink surviving production pruning.
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/dist ./packages/ingenium-extension/dist
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/package.json ./packages/ingenium-extension/package.json
# Repository sync records these configured source paths verbatim. Preserve the
# source artifacts beside the runtime CLI instead of substituting dist paths.
# OpenCode loads these TypeScript entrypoints directly, so retain their explicit
# local import closure without copying the entire extension workspace.
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/auto-observer.ts ./packages/ingenium-extension/auto-observer.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/observer.ts ./packages/ingenium-extension/observer.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/resource-sync.ts ./packages/ingenium-extension/resource-sync.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/skill-sync.ts ./packages/ingenium-extension/skill-sync.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/observer-core.ts ./packages/ingenium-extension/observer-core.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/project-resolver.ts ./packages/ingenium-extension/project-resolver.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/api-auth.ts ./packages/ingenium-extension/api-auth.ts
# The init wrapper invokes this helper during its build-time smoke check. Copy
# the helper first with a non-writable executable mode so it is available without
# widening the runtime copy surface or requiring a privileged repair.
COPY --chown=appuser:appuser --chmod=0555 scripts/normalize-agent-profiles.sh ./scripts/normalize-agent-profiles.sh
COPY --chown=appuser:appuser --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh
RUN chmod 0555 /app/packages/ingenium-extension/dist/scripts/init-project.js && \
    ln -s /app/scripts/run-init-project.sh /usr/local/bin/ingenium-init-project && \
    test -x /usr/local/bin/ingenium-init-project && \
    /usr/local/bin/ingenium-init-project --help

# Copy process management config
COPY --chown=appuser:appuser supervisord.conf ./supervisord.conf
COPY --chown=appuser:appuser scripts/docker-entrypoint.sh ./entrypoint.sh
COPY --chown=appuser:appuser scripts/api-boundary-proxy.mjs scripts/probe-api.mjs scripts/project-opencode-global-config.mjs scripts/run-api.sh scripts/run-api-boundary-proxy.sh scripts/run-dashboard.mjs scripts/run-dashboard.sh scripts/run-gateway.sh scripts/start-opencode-web.sh scripts/wait-for-opencode.sh scripts/start-ttyd.sh scripts/healthcheck.sh scripts/validate-gateway-config.sh scripts/validate-api-boundary.sh ./scripts/
COPY --chown=appuser:appuser nginx/gateway.conf nginx/proxy-common.conf nginx/proxy-dashboard.conf nginx/proxy-opencode.conf nginx/proxy-oauth-callback.conf ./nginx/
# Validate the rendered Nginx configuration as its production user. Runtime
# startup recreates these ephemeral directories before Nginx starts.
RUN install -d -o appuser -g appuser -m 0700 \
      /run/ingenium-gateway \
      /run/ingenium-gateway/client_body \
      /run/ingenium-gateway/proxy \
      /run/ingenium-gateway/fastcgi \
      /run/ingenium-gateway/uwsgi \
      /run/ingenium-gateway/scgi && \
    runuser -u appuser -- sh -ec 'for directory in /run/ingenium-gateway /run/ingenium-gateway/client_body /run/ingenium-gateway/proxy /run/ingenium-gateway/fastcgi /run/ingenium-gateway/uwsgi /run/ingenium-gateway/scgi; do test -w "$directory"; done' && \
    runuser -u appuser -- sh /app/scripts/validate-gateway-config.sh
# Copy agent definitions, commands, and skills (excluded from .dockerignore)
# The packaged init CLI scans repository Markdown from its worktree. Retain the
# canonical documentation tree so its documented all-scope invocation can
# project docs/**/*.md at runtime rather than silently submitting an empty set.
COPY --chown=appuser:appuser docs ./docs
COPY --chown=appuser:appuser .opencode/agents ./.opencode/agents
COPY --chown=appuser:appuser .opencode/commands ./.opencode/commands
COPY --chown=appuser:appuser .opencode/skills ./.opencode/skills
# Copy database migrations (needed for incremental DB upgrades)
COPY packages/ingenium-core/data/migrations/ /app/packages/ingenium-core/data/migrations/
RUN chmod +x /app/entrypoint.sh /app/scripts/*.sh

# Create shared config and data directories with proper ownership
RUN mkdir -p /app/config /app/.ingenium/logs /app/.opencode/skills /workspace && chown -R appuser:appuser /app/config /app/.ingenium /app/.opencode /app/.opencode/skills /workspace
# Pre-create appuser home for OpenCode config persistence
RUN mkdir -p /home/appuser/.config/opencode /home/appuser/.local/share/opencode/log && chown -R appuser:appuser /home/appuser
# Pre-create both the container default and the fallback opencode.json
 RUN echo '{"$schema":"https://opencode.ai/config.json","skills":{"paths":[".opencode/skills"]},"mcp":{"playwright":{"type":"local","command":["npx","-y","@playwright/mcp@0.0.78","--caps=vision"],"enabled":true},"ingenium":{"type":"local","command":["node","/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],"enabled":true,"environment":{"INGENIUM_API_URL":"http://localhost:4097/api/v1","INGENIUM_API_TIMEOUT":"10000","INGENIUM_CORE_DB_PATH":"/app/.ingenium/data","INGENIUM_PROJECT":"global-default"}}},"plugin":["packages/ingenium-extension/auto-observer.ts","packages/ingenium-extension/observer.ts","packages/ingenium-extension/resource-sync.ts"]}' > /app/config/opencode.container.json && \
  cp /app/config/opencode.container.json /app/opencode.json && \
  chown appuser:appuser /app/config/opencode.container.json /app/opencode.json

EXPOSE 3000 4097 1455

ENTRYPOINT ["/app/entrypoint.sh"]
