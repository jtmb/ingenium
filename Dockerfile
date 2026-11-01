# Compile workspace artifacts in the same glibc family as runtime so copied
# native Node modules remain loadable.
FROM node:22-slim AS builder
WORKDIR /app

# Native modules such as better-sqlite3 can fall back to node-gyp when a
# prebuilt binary is unavailable. These build-only tools never enter runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

COPY packages/ingenium-core/package.json ./packages/ingenium-core/
COPY packages/ingenium-email/package.json ./packages/ingenium-email/
COPY packages/ingenium-extension/package.json ./packages/ingenium-extension/
COPY services/ingenium-api/package.json ./services/ingenium-api/
COPY services/ingenium-server/package.json ./services/ingenium-server/
COPY services/ingenium-dashboard/package.json ./services/ingenium-dashboard/
COPY tsconfig.base.json ./

RUN npm ci --workspaces --include-workspace-root

COPY . .
RUN sh scripts/validate-deployment-config.sh
RUN node packages/ingenium-extension/scripts/plugin-source-closure.mjs \
      --materialize /tmp/ingenium-extension-plugin-sources
# These values are intentionally public browser configuration. They must be
# present before the Next.js build because NEXT_PUBLIC_* values are inlined into
# the dashboard bundle; setting them only on the running container is too late.
# The default uses the two local loopback gateway origins, never the
# private OpenCode/ttyd listeners.
ARG NEXT_PUBLIC_OPENCODE_WEB_URL="http://opencode.localhost:3000/"
ARG NEXT_PUBLIC_OPENCODE_CLI_URL="http://cli.localhost:3000/"
ARG NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN=""
ARG NEXT_PUBLIC_RUNTIME_SCHEME=""
ENV NEXT_PUBLIC_OPENCODE_WEB_URL=${NEXT_PUBLIC_OPENCODE_WEB_URL}
ENV NEXT_PUBLIC_OPENCODE_CLI_URL=${NEXT_PUBLIC_OPENCODE_CLI_URL}
ENV NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN=${NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN}
ENV NEXT_PUBLIC_RUNTIME_SCHEME=${NEXT_PUBLIC_RUNTIME_SCHEME}
# The image builder is already isolated; keep its /app artifact paths for runtime COPY.
# Source COPY can retain group-writable directories; distribution security checks require owner-controlled packages.
RUN find . -type d -name node_modules -prune -o -type d -exec chmod g-w,o-w {} +
RUN npm run build --workspaces --if-present

RUN npm prune --omit=dev

# npm can keep incompatible or pinned versions inside individual workspaces.
# Preserve those installed dependency trees alongside the root node_modules.
RUN mkdir -p /tmp/ingenium-workspace-dependencies && \
    for workspace in packages/ingenium-core packages/ingenium-email packages/ingenium-extension services/ingenium-api services/ingenium-server services/ingenium-dashboard; do \
      if [ -d "$workspace/node_modules" ]; then \
        mkdir -p "/tmp/ingenium-workspace-dependencies/$workspace"; \
        cp -a "$workspace/node_modules" "/tmp/ingenium-workspace-dependencies/$workspace/node_modules"; \
      fi; \
    done

# Build-only package extraction: no install scripts or unpinned dependency resolution.
FROM builder AS vendor-security
RUN python3 scripts/prepare-vendor-security.py --manifest config/vendor-security.json --output /vendor-security

FROM builder AS computer-use
RUN python3 -B scripts/prepare-computer-use.py --lock config/computer-use.lock.json \
      --output /external/computer-use

FROM node:22-slim AS runtime-base

ARG OPENCODE_VERSION=2.0.11
ARG OPENCODE_SHA256=59e917d7c0704e84f050619973e28374269b1c814548f8c9ae7942f69d69ee13
ARG CLOUDFLARED_VERSION=2026.10.4
ARG CLOUDFLARED_SHA256=ae5e8add7884b0531d66bbca4570d1de491ff6da51e4ebe7eb160cdf241d9e42
RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor nginx curl ca-certificates tzdata git acl libcap2-bin libssl3 openssl && \
    rm -rf /var/lib/apt/lists/*
# Patch the image's standalone npm tooling without changing application locks.
RUN NPM_CONFIG_CACHE=/tmp/ingenium-runtime-npm-cache NPM_CONFIG_LOGS_DIR=/tmp/ingenium-runtime-npm-logs \
    APPDATA=/tmp/ingenium-runtime-build-appdata LOCALAPPDATA=/tmp/ingenium-runtime-build-localappdata \
    npm install --global --ignore-scripts npm@12.2.1 && \
    test "$(npm --version)" = "12.2.1" && \
    rm -rf /tmp/ingenium-runtime-npm-cache /tmp/ingenium-runtime-npm-logs /tmp/ingenium-runtime-build-appdata /tmp/ingenium-runtime-build-localappdata
RUN curl -fsSL -o /tmp/opencode.tar.gz "https://opencode.ai/files/bin/${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" && \
    echo "${OPENCODE_SHA256}  /tmp/opencode.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin/ opencode && \
    chmod +x /usr/local/bin/opencode && \
    test "$(opencode --version)" = "opencode v${OPENCODE_VERSION}" && \
    opencode --version && \
    rm /tmp/opencode.tar.gz
RUN curl --proto '=https' --tlsv1.2 -fsSL -o /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64" && \
    echo "${CLOUDFLARED_SHA256}  /tmp/cloudflared" | sha256sum -c - && \
    install -o root -g root -m 0555 /tmp/cloudflared /usr/local/bin/cloudflared && \
    cloudflared --version | grep -F "cloudflared version ${CLOUDFLARED_VERSION}" && \
    rm /tmp/cloudflared
# Upstream vendor bundles can lag compatible security patches. Verify expected old
# identities, registry integrity and all resolved dependency ranges before overlaying.
COPY --from=vendor-security /vendor-security/ /tmp/ingenium-vendor-security/
COPY --chown=root:root --chmod=0444 scripts/install-vendor-security.mjs /tmp/install-vendor-security.mjs
RUN node /tmp/install-vendor-security.mjs /tmp/ingenium-vendor-security && \
    rm -rf /tmp/ingenium-vendor-security /tmp/install-vendor-security.mjs
RUN curl -fsSL -o /tmp/ttyd.x86_64 "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64" && \
    echo "8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55  /tmp/ttyd.x86_64" | sha256sum -c - && \
    mv /tmp/ttyd.x86_64 /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd && \
    ttyd --version && \
    rm /tmp/ttyd.x86_64 2>/dev/null || true
RUN userdel -r node && adduser --uid 1000 --disabled-password --comment "" appuser && \
    groupadd --system --gid 1201 ingenium-restore-data && \
    groupadd --system --gid 1202 ingenium-opencode-config && \
    groupadd --system --gid 1203 ingenium-opencode-restore && \
    groupadd --system --gid 1101 ingenium-api && useradd --system --uid 1101 --gid 1101 --groups ingenium-restore-data,ingenium-opencode-config --home-dir /home/ingenium-api --shell /usr/sbin/nologin ingenium-api && \
    groupadd --system --gid 1102 ingenium-boundary && useradd --system --uid 1102 --gid 1102 --home-dir /home/ingenium-boundary --shell /usr/sbin/nologin ingenium-boundary && \
    groupadd --system --gid 1103 ingenium-dashboard && useradd --system --uid 1103 --gid 1103 --home-dir /home/ingenium-dashboard --shell /usr/sbin/nologin ingenium-dashboard && \
    groupadd --system --gid 1104 ingenium-gateway && useradd --system --uid 1104 --gid 1104 --home-dir /home/ingenium-gateway --shell /usr/sbin/nologin ingenium-gateway && \
    groupadd --system --gid 1105 ingenium-opencode && useradd --system --uid 1105 --gid 1105 --groups ingenium-opencode-config,ingenium-opencode-restore --home-dir /home/ingenium-opencode --shell /usr/sbin/nologin ingenium-opencode && \
    groupadd --system --gid 1106 ingenium-ttyd && useradd --system --uid 1106 --gid 1106 --home-dir /home/ingenium-ttyd --shell /usr/sbin/nologin ingenium-ttyd && \
    groupadd --system --gid 1108 ingenium-restore && useradd --system --uid 1108 --gid 1108 --groups ingenium-api,ingenium-restore-data,ingenium-opencode-restore --home-dir /home/ingenium-restore --shell /usr/sbin/nologin ingenium-restore && \
    groupadd --system --gid 1109 ingenium-runtime-manager && useradd --system --uid 1109 --gid 1109 --home-dir /home/ingenium-runtime-manager --shell /usr/sbin/nologin ingenium-runtime-manager && \
    groupadd --system --gid 1110 ingenium-runtime-gateway && useradd --system --uid 1110 --gid 1110 --home-dir /home/ingenium-runtime-gateway --shell /usr/sbin/nologin ingenium-runtime-gateway && \
    groupadd --system --gid 1111 ingenium-cloudflare && useradd --system --uid 1111 --gid 1111 --home-dir /nonexistent --shell /usr/sbin/nologin ingenium-cloudflare && \
    install -d -o root -g root -m 0755 /usr/local/share/ingenium && \
    install -d -o root -g root -m 0555 /etc/ingenium && \
    id -u appuser > /usr/local/share/ingenium/appuser-uid && id -g appuser > /usr/local/share/ingenium/appuser-gid && \
    id -u ingenium-api > /usr/local/share/ingenium/api-uid && id -g ingenium-api > /usr/local/share/ingenium/api-gid && \
    id -u ingenium-dashboard > /usr/local/share/ingenium/dashboard-uid && id -g ingenium-dashboard > /usr/local/share/ingenium/dashboard-gid && \
    id -u ingenium-opencode > /usr/local/share/ingenium/opencode-uid && id -g ingenium-opencode > /usr/local/share/ingenium/opencode-gid && \
    id -u ingenium-restore > /usr/local/share/ingenium/restore-uid && id -g ingenium-restore > /usr/local/share/ingenium/restore-gid && \
    id -u ingenium-runtime-manager > /usr/local/share/ingenium/runtime-manager-uid && id -g ingenium-runtime-manager > /usr/local/share/ingenium/runtime-manager-gid && \
    id -u ingenium-runtime-gateway > /usr/local/share/ingenium/runtime-gateway-uid && id -g ingenium-runtime-gateway > /usr/local/share/ingenium/runtime-gateway-gid && \
    getent group ingenium-restore-data | cut -d: -f3 > /usr/local/share/ingenium/restore-data-gid && \
    chown root:root /usr/local/share/ingenium/*-uid /usr/local/share/ingenium/*-gid && chmod 0444 /usr/local/share/ingenium/*-uid /usr/local/share/ingenium/*-gid && \
    install -d -o ingenium-api -g ingenium-api -m 0700 /home/ingenium-api /home/ingenium-api/.config /home/ingenium-api/.local /home/ingenium-api/.local/share && \
    install -d -o ingenium-boundary -g ingenium-boundary -m 0700 /home/ingenium-boundary && \
    install -d -o ingenium-dashboard -g ingenium-dashboard -m 0700 /home/ingenium-dashboard && \
    install -d -o ingenium-gateway -g ingenium-gateway -m 0700 /home/ingenium-gateway && \
    install -d -o ingenium-opencode -g ingenium-opencode -m 0700 /home/ingenium-opencode && \
    install -d -o ingenium-ttyd -g ingenium-ttyd -m 0700 /home/ingenium-ttyd && \
    install -d -o ingenium-restore -g ingenium-restore -m 0700 /home/ingenium-restore && \
    install -d -o ingenium-runtime-manager -g ingenium-runtime-manager -m 0700 /home/ingenium-runtime-manager && \
    install -d -o ingenium-runtime-gateway -g ingenium-runtime-gateway -m 0700 /home/ingenium-runtime-gateway && \
    install -d -o ingenium-cloudflare -g ingenium-cloudflare -m 0700 /run/ingenium-secrets/cloudflare && \
    install -d -o root -g root -m 0755 /usr/local/libexec && \
    install -o root -g ingenium-restore -m 0750 /usr/local/bin/node /usr/local/libexec/ingenium-restore-node && \
    setcap cap_chown,cap_fowner=ep /usr/local/libexec/ingenium-restore-node

WORKDIR /app

COPY --from=builder --chown=root:root /app/node_modules ./node_modules
RUN playwright_cli="$(node -e 'const r = require("node:module").createRequire(require.resolve("@playwright/mcp")); process.stdout.write(require("node:path").join(require("node:path").dirname(r.resolve("playwright/package.json")), "cli.js"))')" && \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ingenium-playwright/browsers node "$playwright_cli" install --with-deps chromium && \
    browser_path="$(PLAYWRIGHT_BROWSERS_PATH=/opt/ingenium-playwright/browsers node -e 'process.stdout.write(require("node:module").createRequire(require.resolve("@playwright/mcp"))("playwright").chromium.executablePath())')" && \
    test -x "$browser_path" && \
    ln -s "$browser_path" /opt/ingenium-playwright/chromium && \
    test "$(realpath /opt/ingenium-playwright/chromium)" = "$browser_path"
# Fail the image build if the copied native binding cannot load on the runtime
# libc. This protects the API from a delayed better-sqlite3 startup failure.
RUN node -e 'require("better-sqlite3")'
COPY --from=builder --chown=root:root /app/packages/ingenium-core/dist ./packages/ingenium-core/dist
COPY --from=builder --chown=root:root /app/packages/ingenium-core/package.json ./packages/ingenium-core/
COPY --from=builder --chown=root:root /app/packages/ingenium-email/dist ./packages/ingenium-email/dist
COPY --from=builder --chown=root:root /app/packages/ingenium-email/package.json ./packages/ingenium-email/
COPY --from=builder --chown=root:root /app/services/ingenium-api/dist ./services/ingenium-api/dist
COPY --from=builder --chown=root:root --chmod=0444 /app/services/ingenium-api/config/dashboard-safe-reads.json ./services/ingenium-api/dist/config/dashboard-safe-reads.json
COPY --from=builder --chown=root:root /app/services/ingenium-api/package.json ./services/ingenium-api/
COPY --from=builder --chown=root:root /app/services/ingenium-server/dist ./services/ingenium-server/dist
COPY --from=builder --chown=root:root /app/services/ingenium-server/package.json ./services/ingenium-server/
COPY --from=builder --chown=root:root /app/services/ingenium-dashboard/.next/standalone ./
COPY --from=builder --chown=root:root /app/services/ingenium-dashboard/public ./services/ingenium-dashboard/public
COPY --from=builder --chown=root:root /app/services/ingenium-dashboard/.next/static ./services/ingenium-dashboard/.next/static
# The init CLI is an independently documented runtime command. Copy only the
# package distribution and expose it via a stable PATH location rather than
# relying on a workspace node_modules/.bin symlink surviving production pruning.
COPY --from=builder --chown=root:root /app/packages/ingenium-extension/dist ./packages/ingenium-extension/dist
COPY --from=builder --chown=root:root /app/packages/ingenium-extension/package.json ./packages/ingenium-extension/package.json
# Repository sync records these configured source paths verbatim. Preserve the
# source artifacts beside the runtime CLI instead of substituting dist paths.
# OpenCode loads these TypeScript entrypoints directly. The builder derives and
# validates their complete local graph plus Ponytail's dynamic runtime assets.
COPY --from=builder --chown=root:root /tmp/ingenium-extension-plugin-sources ./packages/ingenium-extension
COPY --from=builder --chown=root:root /tmp/ingenium-workspace-dependencies/ ./
RUN chmod 0444 /app/packages/ingenium-extension/scripts/source-snapshot.mjs && \
    test "$(stat -c '%u:%g:%a' /app/packages/ingenium-extension/scripts/source-snapshot.mjs)" = "0:0:444"
COPY --from=builder --chown=root:root /app/packages/ingenium-extension/scripts/smoke-opencode-plugin-load.mjs /tmp/smoke-opencode-plugin-load.mjs
RUN node /tmp/smoke-opencode-plugin-load.mjs /app/packages/ingenium-extension /usr/local/bin/opencode && \
    rm /tmp/smoke-opencode-plugin-load.mjs
# Some configured builders retain checkout modes despite COPY --chmod. Normalize
# these narrow executable inputs explicitly before the build-time smoke check.
COPY --chown=root:root --chmod=0444 scripts/derive-workspace-opencode-config.mjs ./scripts/
COPY --chown=root:root --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/
COPY --chown=root:root --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh
RUN chmod 0555 \
      /app/packages/ingenium-extension/dist/scripts/init-project.js \
      /app/scripts/normalize-agent-profiles.sh \
      /app/scripts/project-agent-profiles.mjs \
      /app/scripts/run-init-project.sh && \
    test "$(stat -c '%U:%G:%a' /app/scripts/run-init-project.sh)" = "root:root:555" && \
    ln -s /app/scripts/run-init-project.sh /usr/local/bin/ingenium-init-project && \
    test -x /usr/local/bin/ingenium-init-project && \
    /usr/local/bin/ingenium-init-project --help && \
    test "$(/usr/local/bin/ingenium-init-project --version)" = "1.0.0"

# Supervisor and the entrypoint resolve these explicit `/app` paths at runtime;
# copy only their declared scripts instead of retaining the builder source tree.
COPY --chown=root:root supervisord.conf control-plane-supervisord.conf runtime-supervisord.conf ./
COPY --chown=root:root --chmod=0555 scripts/docker-entrypoint.sh ./entrypoint.sh
# `/dev/shm` is a container-runtime tmpfs. Do not create this VAULT-101 root at
# build time: the entrypoint provisions and validates it on every container start.
COPY --chown=root:root scripts/api-boundary-proxy.mjs scripts/generate-dashboard-safe-read-policy.mjs scripts/opencode-auth-proxy.mjs scripts/probe-api.mjs scripts/project-opencode-global-config.mjs scripts/provision-dashboard-bootstrap-token.mjs scripts/read-protected-api-token.mjs scripts/restore-handoff.mjs scripts/runtime-control-entrypoint.sh scripts/runtime-gateway-healthcheck.mjs scripts/runtime-manager-healthcheck.mjs scripts/run-api.sh scripts/run-api-boundary-proxy.sh scripts/run-dashboard.sh scripts/run-gateway.sh scripts/run-restore-handoff.sh scripts/run-restore-maintenance.sh scripts/recover-restore-maintenance.sh scripts/start-cloudflare-tunnel.sh scripts/start-opencode-auth-proxy.sh scripts/start-opencode-web.sh scripts/start-runtime-opencode-web.sh scripts/wait-for-opencode.sh scripts/start-ttyd.sh scripts/healthcheck.sh scripts/runtime-healthcheck.sh scripts/runtime-entrypoint.sh scripts/validate-gateway-config.sh scripts/validate-api-boundary.sh scripts/validate-root-entrypoint-chain.mjs ./scripts/
COPY --chown=root:root --chmod=0444 supervisord.conf ./supervisord.conf
COPY --chown=root:root --chmod=0555 scripts/run-restore-handoff.sh scripts/run-restore-maintenance.sh scripts/recover-restore-maintenance.sh ./scripts/
COPY --chown=root:root --chmod=0444 scripts/provision-opencode-mcp-credential.mjs ./scripts/
COPY --chown=root:root --chmod=0555 scripts/validate-vault-job-secret-root.sh scripts/validate-process-isolation.sh ./scripts/
COPY --chown=root:root --chmod=0555 scripts/provision-auth-encryption-key.sh ./scripts/provision-auth-encryption-key.sh
# Nginx resolves includes from `/app/nginx` during build validation and runtime
# startup, so copy its primary configuration and declared include set together.
COPY --chown=root:root nginx/dashboard-safe-reads-map.conf nginx/gateway.conf nginx/public-information.conf nginx/proxy-common.conf nginx/proxy-dashboard.conf nginx/proxy-opencode.conf nginx/proxy-oauth-callback.conf nginx/runtime-aliases-compatibility.conf nginx/runtime-aliases-production.conf nginx/runtime-alias-unavailable-location.conf ./nginx/
# Validate the rendered Nginx configuration as its production user. Runtime
# startup recreates these ephemeral directories before Nginx starts.
RUN install -d -o ingenium-gateway -g ingenium-gateway -m 0700 \
      /run/ingenium-gateway \
      /run/ingenium-gateway/client_body \
      /run/ingenium-gateway/proxy \
      /run/ingenium-gateway/fastcgi \
      /run/ingenium-gateway/uwsgi \
      /run/ingenium-gateway/scgi && \
    ln -sf /app/nginx/runtime-aliases-compatibility.conf /run/ingenium-gateway/runtime-aliases.conf && \
    runuser -u ingenium-gateway -- sh -ec 'for directory in /run/ingenium-gateway /run/ingenium-gateway/client_body /run/ingenium-gateway/proxy /run/ingenium-gateway/fastcgi /run/ingenium-gateway/uwsgi /run/ingenium-gateway/scgi; do test -w "$directory"; done' && \
    runuser -u ingenium-gateway -- sh /app/scripts/validate-gateway-config.sh
# OpenCode initialization reads these authoritative declarations from disk.
# The packaged init CLI scans repository Markdown from its worktree. Retain the
# canonical documentation tree so its documented all-scope invocation can
# project docs/**/*.md at runtime rather than silently submitting an empty set.
COPY --chown=root:root docs ./docs
COPY --chown=root:root .opencode/agents ./.opencode/agents
COPY --chown=root:root .opencode/commands ./.opencode/commands
COPY --chown=root:root .opencode/skills ./.opencode/skills
COPY --from=computer-use --chown=root:root /external/computer-use /usr/local/share/veyra/computer-use
COPY --chown=root:root config/computer-use-plugin /usr/local/share/veyra/computer-use-plugin
COPY --chown=root:root config/computer-use.lock.json /usr/local/share/veyra/computer-use.lock.json
COPY --chown=root:root config/opencode-managed ./config/opencode-managed
# Copy database migrations (needed for incremental DB upgrades)
COPY packages/ingenium-core/data/migrations/ /app/packages/ingenium-core/data/migrations/
# Require the explicit candidate/authority artifacts; no discovery or runtime execution.
RUN node -e 'const fs=require('\''node:fs'\'');const files=["/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-candidate-material.mjs","/app/services/ingenium-api/dist/lib/dot-v2/candidate-bootstrap-runtime.mjs","/app/services/ingenium-api/dist/lib/dot-v2/candidate-carrier.mjs","/app/services/ingenium-api/dist/lib/dot-v2/candidate-docker-stream.mjs","/app/services/ingenium-api/dist/lib/dot-v2/candidate-loopback.mjs","/app/services/ingenium-api/dist/lib/dot-v2/candidate-original-invocation.mjs","/app/services/ingenium-api/dist/lib/dot-v2/candidate-private-plugin.mjs","/app/services/ingenium-api/dist/scripts/runtime-candidate-bootstrap.js","/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-image-contract.mjs","/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-manager-proof.mjs","/app/services/ingenium-api/dist/lib/dot-v2/core126-actual-factory.js","/app/services/ingenium-api/dist/lib/dot-v2/dot-original-context.js","/app/services/ingenium-api/dist/lib/dot-v2/installed-dot-approved-scope.js","/app/services/ingenium-api/dist/lib/dot-v2/dot-approved-scope.mjs","/app/services/ingenium-api/dist/lib/dot-v2/dot-job-policy.mjs","/app/services/ingenium-api/dist/lib/dot-v2/repository.js","/app/services/ingenium-api/dist/lib/dot-v2/request-binding.js","/app/services/ingenium-api/dist/lib/dot-v2/service.js","/app/services/ingenium-api/dist/lib/dot-v2/schedule.js","/app/services/ingenium-api/dist/lib/dot-v2/existing-jobs.js","/app/services/ingenium-api/dist/lib/projects-v2/request-chat-source.mjs","/app/services/ingenium-api/dist/lib/job-response-verification.js","/app/services/ingenium-api/dist/lib/runtime-manager-client.js","/app/services/ingenium-api/dist/lib/runtime-manager-auth.js","/app/services/ingenium-api/dist/lib/runtime-placement-contract.js","/app/services/ingenium-api/dist/lib/dot-v2/core126-runtime.js","/app/services/ingenium-api/dist/lib/dot-v2/core126-provider-resolution.js","/app/services/ingenium-api/dist/lib/job-native-provider.js","/app/services/ingenium-api/dist/lib/opencode-client.js","/app/services/ingenium-api/dist/lib/dot-v2/managed-job-owner.mjs","/app/services/ingenium-api/dist/lib/dot-v2/managed-job-core-client.mjs","/app/services/ingenium-api/dist/lib/dot-v2/core126-broker.js","/app/services/ingenium-api/dist/lib/dot-v2/core126-broker.mjs","/app/packages/ingenium-core/dist/lib/index.js","/app/packages/ingenium-core/dist/lib/db.js","/app/packages/ingenium-core/dist/lib/schema.js","/app/packages/ingenium-core/dist/lib/tools/dot-execution-delegation.js","/app/packages/ingenium-core/dist/lib/tools/jobs.js","/app/packages/ingenium-core/dist/lib/tools/runtimes.js","/app/packages/ingenium-core/dist/lib/tools/context-conversations.js","/app/packages/ingenium-core/dist/lib/tools/trusted-job-events.js","/app/packages/ingenium-core/dist/lib/tools/agents.js","/app/packages/ingenium-core/dist/lib/tools/authorization.js","/app/packages/ingenium-core/dist/lib/tools/mcp-authorization-policy.js","/app/packages/ingenium-core/dist/lib/tools/job-providers.js","/app/packages/ingenium-core/dist/lib/tools/vault.js","/app/packages/ingenium-core/dist/lib/tools/runtime-original-provision.js","/app/packages/ingenium-core/dist/lib/tools/authentication.js"];for(const file of files){const st=fs.lstatSync(file);if(fs.realpathSync(file)!==file||!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o022)||st.size<1)throw Error('\''Missing or mutable original candidate artifact: '\''+file);}'
# Verify the same Core build-owned explicit restore helper closure and actual SQL132 consumer path.
RUN node -e 'const fs=require('\''node:fs'\'');for(const file of ["/app/packages/ingenium-core/dist/lib/tools/backups.js","/app/packages/ingenium-core/dist/lib/tools/learned-memory-restore.mjs","/app/packages/ingenium-core/dist/lib/tools/learned-memory-restore.d.mts","/app/packages/ingenium-core/dist/lib/tools/voice-attachment-restore.mjs","/app/packages/ingenium-core/dist/lib/tools/voice-attachment-restore.d.mts","/app/packages/ingenium-core/dist/veyra-core-runtime-closure.json","/app/packages/ingenium-core/dist/data/migrations/132_voice_attachment_deliveries.sql"]){const st=fs.lstatSync(file);if(fs.realpathSync(file)!==file||!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o022)||st.size<1)throw Error('\''Original Core restore artifact unavailable: '\''+file);}'
# COPY already assigns root ownership. Avoid copying every unchanged inode into
# a new overlay layer; repair only deviations, without following symbolic links.
RUN find /app/node_modules /app/packages /app/services /app/scripts /app/docs /app/.opencode /app/nginx \
      \( ! -user root -o ! -group root \) -exec chown -h root:root {} + && \
    find /app/node_modules /app/packages /app/services /app/scripts /app/docs /app/.opencode /app/nginx \
      ! -type l -perm /022 -exec chmod go-w {} + && \
    chmod 0444 /app/.opencode/agents/execution/ingenium-llm-broker.md && \
    install -d -o root -g root -m 0555 /usr/local/share/ingenium/opencode-managed /usr/local/share/ingenium/opencode-managed/agents /usr/local/share/ingenium/opencode-managed/plugins /usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker /usr/local/share/ingenium/opencode-managed/plugins/enforce-job-agent /etc/opencode && \
    install -o root -g root -m 0444 /app/config/opencode-managed/opencode.json /usr/local/share/ingenium/opencode-managed/opencode.json && \
    install -o root -g root -m 0444 /app/config/opencode-managed/job-opencode.json /usr/local/share/ingenium/opencode-managed/job-opencode.json && \
    install -o root -g root -m 0444 /app/config/opencode-managed/candidate-inert-catalog.json /usr/local/share/ingenium/opencode-managed/candidate-inert-catalog.json && \
    install -o root -g root -m 0444 /app/config/opencode-managed/plugins/enforce-job-agent/index.mjs /usr/local/share/ingenium/opencode-managed/plugins/enforce-job-agent/index.mjs && \
    install -o root -g root -m 0444 /app/config/opencode-managed/plugins/enforce-reserved-broker/index.mjs /usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker/index.mjs && \
    install -o root -g root -m 0444 /app/.opencode/agents/execution/ingenium-llm-broker.md /usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md && \
    node /app/scripts/derive-workspace-opencode-config.mjs && \
    ln -s /usr/local/share/ingenium/opencode-managed/opencode.json /etc/opencode/opencode.json && \
    chown root:root /app /app/packages /app/services /app/services/ingenium-api /app/entrypoint.sh /app/control-plane-supervisord.conf /app/runtime-supervisord.conf /app/supervisord.conf && \
    chmod 0755 /app /app/packages /app/services /app/services/ingenium-api && chmod 0555 /app/scripts /app/entrypoint.sh /app/scripts/*.sh && \
    chmod 0444 /app/control-plane-supervisord.conf /app/runtime-supervisord.conf /app/supervisord.conf /app/scripts/*.mjs && \
    node /app/scripts/validate-root-entrypoint-chain.mjs && \
    runuser -u appuser -- env NODE_ENV=production node --input-type=module -e 'const core = await import("file:///app/packages/ingenium-core/dist/lib/index.js"); const trustedAgents = core.agents ?? core.default?.agents; if (typeof trustedAgents?.validateProtectedOpenCodeDeployment !== "function") throw new Error("Trusted Ingenium Core broker validator is unavailable"); trustedAgents.validateProtectedOpenCodeDeployment();'

# Named volumes and runtime state must be writable by unprivileged services on
# first start, rather than relying on root-created directories.
RUN mkdir -p /app/config /app/.ingenium/logs /workspace && \
    chown root:root /app/config /workspace && \
    chown -R ingenium-api:ingenium-restore-data /app/.ingenium
# OpenCode persists configuration and state under its dedicated home directory.
RUN mkdir -p /home/ingenium-opencode/.config/opencode /home/ingenium-opencode/.local/share/opencode/log && \
    chown -R ingenium-opencode:ingenium-opencode /home/ingenium-opencode
# The bundled editor was retired; preserve legacy data outside the new package.
# Compose overlays `/app/opencode.json` with repository configuration. Keep the
# generated image fallback under `/app/config` when that mount hides the root copy.
RUN echo '{"$schema":"https://opencode.ai/config.json","skills":[".opencode/skills"],"mcp":{"servers":{"ingenium":{"type":"local","command":["node","/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],"environment":{"INGENIUM_API_URL":"http://localhost:4097/api/v1","INGENIUM_API_TIMEOUT":"10000","INGENIUM_CORE_DB_PATH":"/app/.ingenium/data","INGENIUM_PROJECT":"global-default"},"disabled":false}}},"plugins":["/usr/local/share/veyra/computer-use-plugin","/app/packages/ingenium-extension/plugins/v2/auto-observer","/app/packages/ingenium-extension/plugins/v2/observer","/app/packages/ingenium-extension/plugins/v2/resource-sync","/app/packages/ingenium-extension/plugins/v2/lifecycle","/app/packages/ingenium-extension/plugins/v2/ponytail","/app/packages/ingenium-extension/plugins/v2/goal"]}' > /app/config/opencode.container.json && \
  cp /app/config/opencode.container.json /app/opencode.json && \
  chown root:root /app/config/opencode.container.json /app/opencode.json && \
  chmod 0444 /app/config/opencode.container.json /app/opencode.json

# Keep validated provenance late so a revision change does not rebuild pinned
# runtime dependencies. Every final target inherits these labels.
ARG IMAGE_REVISION
ARG IMAGE_SOURCE="https://github.com/jtmb/ingenium"
ARG IMAGE_SOURCE_SHA256=""
RUN test -z "$IMAGE_SOURCE_SHA256" || { test "${#IMAGE_SOURCE_SHA256}" -eq 64 && printf '%s' "$IMAGE_SOURCE_SHA256" | grep -Eq '^[0-9a-f]{64}$'; }
RUN printf '%s' "$IMAGE_REVISION" | grep -Eq '^[0-9a-f]{40}$' && \
    case "$IMAGE_SOURCE" in https://*/*) ;; *) exit 1 ;; esac && \
    case "$IMAGE_SOURCE" in *"@"*|*"?"*|*"#"*) exit 1 ;; esac
LABEL org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.ingenium.source.sha256="${IMAGE_SOURCE_SHA256}"

FROM runtime-base AS user-runtime
USER appuser
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=90s CMD ["/app/scripts/runtime-healthcheck.sh"]
ENTRYPOINT ["/app/scripts/runtime-entrypoint.sh"]

FROM runtime-base AS runtime-manager
USER root
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s CMD ["setpriv", "--reuid=1109", "--regid=1109", "--clear-groups", "node", "/app/scripts/runtime-manager-healthcheck.mjs"]
ENTRYPOINT ["/app/scripts/runtime-control-entrypoint.sh", "manager"]

FROM runtime-base AS runtime-gateway
USER root
EXPOSE 8080 8443
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s CMD ["setpriv", "--reuid=1110", "--regid=1110", "--clear-groups", "node", "/app/scripts/runtime-gateway-healthcheck.mjs"]
ENTRYPOINT ["/app/scripts/runtime-control-entrypoint.sh", "gateway"]

FROM runtime-base AS control-plane
ENV INGENIUM_DEPLOYMENT_MODE=control-plane
EXPOSE 3000 4097 1456
ENTRYPOINT ["/app/entrypoint.sh"]

FROM runtime-base AS compatibility
ENV INGENIUM_DEPLOYMENT_MODE=compatibility
EXPOSE 3000 4097 1456
ENTRYPOINT ["/app/entrypoint.sh"]
