# Compile workspace artifacts in the same glibc family as runtime so copied
# native Node modules remain loadable.
FROM node:22-slim AS builder
WORKDIR /app

# Native modules such as better-sqlite3 can fall back to node-gyp when a
# prebuilt binary is unavailable. These build-only tools never enter runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
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

RUN npm prune --omit=dev

FROM node:22-slim AS runtime-base

# Keep provenance as build arguments because `.git` is excluded from the build
# context. The revision must be a lowercase full SHA for deployment comparison;
# source accepts only an HTTPS repository-shaped URL without literal userinfo,
# query, or fragment components before it becomes public OCI metadata.
ARG IMAGE_REVISION
ARG IMAGE_SOURCE="https://github.com/jtmb/ingenium"
RUN printf '%s' "$IMAGE_REVISION" | grep -Eq '^[0-9a-f]{40}$' && \
    case "$IMAGE_SOURCE" in https://*/*) ;; *) exit 1 ;; esac && \
    case "$IMAGE_SOURCE" in *"@"*|*"?"*|*"#"*) exit 1 ;; esac
LABEL org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.source="${IMAGE_SOURCE}"

ARG OPENCODE_VERSION=1.18.9
ARG OPENCODE_SHA256=a0fa4b7b8bdacbd013e79a5f69d4220d36b545cd3ea296ba765f3016fa501b5b
RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor nginx curl ca-certificates tzdata git && \
    rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/opencode.tar.gz "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" && \
    echo "${OPENCODE_SHA256}  /tmp/opencode.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin/ opencode && \
    chmod +x /usr/local/bin/opencode && \
    test "$(opencode --version)" = "${OPENCODE_VERSION}" && \
    opencode --version && \
    rm /tmp/opencode.tar.gz
RUN curl -fsSL -o /tmp/code-server.tar.gz "https://github.com/coder/code-server/releases/download/v4.131.0/code-server-4.131.0-linux-amd64.tar.gz" && \
    echo "f6316f0b14ef5c12ed6e67e0154dd02ccf5e66112064687d7e93c51763105361  /tmp/code-server.tar.gz" | sha256sum -c - && \
    mkdir -p /usr/local/lib/code-server && \
    tar -xzf /tmp/code-server.tar.gz -C /usr/local/lib/code-server --strip-components=1 && \
    ln -s /usr/local/lib/code-server/bin/code-server /usr/local/bin/code-server && \
    code-server --version | grep -Eq '^4\.131\.0([[:space:]]|$)' && \
    rm /tmp/code-server.tar.gz
COPY --chown=root:root --chmod=0444 config/vscode-extensions/ingenium.system-theme-defaults/package.json /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json
RUN set -eu; \
    builtin_manifest="/usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json"; \
    builtin_dir="$(dirname "$builtin_manifest")"; \
    test -d "/usr/local/lib/code-server/lib/vscode/extensions"; \
    test -d "$builtin_dir"; \
    chmod 0755 "$builtin_dir"; \
    test "$(stat -c '%U:%G:%a' "$builtin_manifest")" = "root:root:444"; \
    BUILTIN_MANIFEST="$builtin_manifest" CODE_SERVER_VSCODE_VERSION="$(code-server --version | sed -n 's/.* with Code \([0-9][0-9.]*\)$/\1/p')" node -e 'const fs=require("fs"); const manifestPath=process.env.BUILTIN_MANIFEST; const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8")); const defaults={"window.autoDetectColorScheme":true,"workbench.preferredDarkColorTheme":"Dark Modern","workbench.preferredLightColorTheme":"Light Modern"}; const runtime=/^(\d+)\.(\d+)\.(\d+)$/.exec(process.env.CODE_SERVER_VSCODE_VERSION ?? ""); const engine=/^\^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.engines?.vscode ?? ""); const atLeast=(actual,minimum)=>actual[0]>minimum[0] || actual[0]===minimum[0] && (actual[1]>minimum[1] || actual[1]===minimum[1] && actual[2]>=minimum[2]); const forbidden=["main","browser","activationEvents","scripts","dependencies","devDependencies","permissions"]; if (manifest.name!=="system-theme-defaults" || manifest.publisher!=="ingenium" || manifest.version!=="1.0.0" || !runtime || !engine || Number(runtime[1])!==Number(engine[1]) || !atLeast(runtime.slice(1).map(Number),engine.slice(1).map(Number)) || JSON.stringify(manifest.contributes?.configurationDefaults)!==JSON.stringify(defaults) || forbidden.some((key)=>Object.hasOwn(manifest,key)) || JSON.stringify(fs.readdirSync(require("path").dirname(manifestPath)).sort())!=="[\"package.json\"]") throw new Error("built-in VS Code theme defaults manifest validation failed");';
RUN set -eu; \
    extension_file="/usr/local/share/ingenium/vscode-extensions/sst-dev.opencode-0.0.13.vsix"; \
    install -d -o root -g root -m 0755 /usr/local/share/ingenium/vscode-extensions; \
    curl --proto '=https' --tlsv1.2 -fsSL -o /tmp/sst-dev.opencode-0.0.13.vsix "https://open-vsx.org/api/sst-dev/opencode/0.0.13/file/sst-dev.opencode-0.0.13.vsix"; \
    echo "e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4  /tmp/sst-dev.opencode-0.0.13.vsix" | sha256sum -c -; \
    install -o root -g root -m 0444 /tmp/sst-dev.opencode-0.0.13.vsix "$extension_file"; \
    rm /tmp/sst-dev.opencode-0.0.13.vsix; \
    extension_temp_dir="$(mktemp -d)"; \
    code-server --user-data-dir "$extension_temp_dir/user-data" --extensions-dir "$extension_temp_dir/extensions" --install-extension "$extension_file" --force; \
    extension_list="$(code-server --user-data-dir "$extension_temp_dir/user-data" --extensions-dir "$extension_temp_dir/extensions" --list-extensions --show-versions)"; \
    test "$extension_list" = "sst-dev.opencode@0.0.13"; \
    EXTENSION_MANIFEST="$extension_temp_dir/extensions/sst-dev.opencode-0.0.13/package.json" CODE_SERVER_VSCODE_VERSION="$(code-server --version | sed -n 's/.* with Code \([0-9][0-9.]*\)$/\1/p')" node -e 'const fs=require("fs"); const manifest=JSON.parse(fs.readFileSync(process.env.EXTENSION_MANIFEST,"utf8")); const version=(value)=>{const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? ""); return match ? match.slice(1).map(Number) : null;}; const compare=(left,right)=>left[0]-right[0] || left[1]-right[1] || left[2]-right[2]; const satisfies=(range,actual)=>range.split("||").some((clause)=>clause.trim().split(/\s+/).every((token)=>{if (token==="*" || token==="x") return true; const match=/(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(token); if (!match) return false; const [,operator="",major,minor="0",patch="0"]=match; const minimum=[Number(major),Number(minor === "x" || minor === "*" ? 0 : minor),Number(patch === "x" || patch === "*" ? 0 : patch)]; const result=compare(actual,minimum); if (minor === "x" || minor === "*") return actual[0]===minimum[0]; if (patch === "x" || patch === "*") return actual[0]===minimum[0] && actual[1]===minimum[1]; if (operator==="^") return result>=0 && (minimum[0] > 0 ? actual[0]===minimum[0] : minimum[1] > 0 ? actual[0]===0 && actual[1]===minimum[1] : actual[0]===0 && actual[1]===0 && actual[2]===minimum[2]); if (operator==="~") return result>=0 && actual[0]===minimum[0] && actual[1]===minimum[1]; return ({">":result>0,">=":result>=0,"<":result<0,"<=":result<=0,"=":result===0,"":result===0})[operator];})); const runtime=version(process.env.CODE_SERVER_VSCODE_VERSION); if (manifest.publisher!=="sst-dev" || manifest.name!=="opencode" || manifest.version!=="0.0.13" || typeof manifest.engines?.vscode!=="string" || !runtime || !satisfies(manifest.engines.vscode,runtime)) throw new Error("baked VSIX manifest identity or VS Code engine compatibility check failed");'; \
    rm -rf "$extension_temp_dir"; \
    test "$(stat -c '%U:%G:%a' "$extension_file")" = "root:root:444"
RUN curl -fsSL -o /tmp/ttyd.x86_64 "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64" && \
    echo "8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55  /tmp/ttyd.x86_64" | sha256sum -c - && \
    mv /tmp/ttyd.x86_64 /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd && \
    ttyd --version && \
    rm /tmp/ttyd.x86_64 2>/dev/null || true
RUN userdel -r node && adduser --uid 1000 --disabled-password --comment "" appuser && \
    install -d -o root -g root -m 0755 /usr/local/share/ingenium && \
    id -u appuser > /usr/local/share/ingenium/appuser-uid && id -g appuser > /usr/local/share/ingenium/appuser-gid && \
    chown root:root /usr/local/share/ingenium/appuser-uid /usr/local/share/ingenium/appuser-gid && chmod 0444 /usr/local/share/ingenium/appuser-uid /usr/local/share/ingenium/appuser-gid && \
    runuser -u appuser -- test -r /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json

WORKDIR /app

COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
# Fail the image build if the copied native binding cannot load on the runtime
# libc. This protects the API from a delayed better-sqlite3 startup failure.
RUN node -e 'require("better-sqlite3")'
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
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/plugins/auto-observer.ts ./packages/ingenium-extension/plugins/auto-observer.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/observer.ts ./packages/ingenium-extension/observer.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/plugins/observer.ts ./packages/ingenium-extension/plugins/observer.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/resource-sync.ts ./packages/ingenium-extension/resource-sync.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/plugins/resource-sync.ts ./packages/ingenium-extension/plugins/resource-sync.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/skill-sync.ts ./packages/ingenium-extension/skill-sync.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/observer-core.ts ./packages/ingenium-extension/observer-core.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/project-resolver.ts ./packages/ingenium-extension/project-resolver.ts
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/api-auth.ts ./packages/ingenium-extension/api-auth.ts
# Ponytail is an official immutable local checkout, not an npm dependency. Its
# CommonJS companions, commands, and skills form the adapter's complete runtime
# closure and remain outside the worktree .opencode/plugins discovery root.
COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/ponytail ./packages/ingenium-extension/ponytail
# The init wrapper invokes this helper during its build-time smoke check. Copy
# the helper first with a non-writable executable mode so it is available without
# widening the runtime copy surface or requiring a privileged repair.
COPY --chown=appuser:appuser --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/
COPY --chown=appuser:appuser --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh
RUN chmod 0555 /app/packages/ingenium-extension/dist/scripts/init-project.js && \
    ln -s /app/scripts/run-init-project.sh /usr/local/bin/ingenium-init-project && \
    test -x /usr/local/bin/ingenium-init-project && \
    /usr/local/bin/ingenium-init-project --help

# Supervisor and the entrypoint resolve these explicit `/app` paths at runtime;
# copy only their declared scripts instead of retaining the builder source tree.
COPY --chown=appuser:appuser supervisord.conf control-plane-supervisord.conf runtime-supervisord.conf ./
COPY --chown=appuser:appuser scripts/docker-entrypoint.sh ./entrypoint.sh
# `/dev/shm` is a container-runtime tmpfs. Do not create this VAULT-101 root at
# build time: the entrypoint provisions and validates it on every container start.
COPY --chown=appuser:appuser scripts/api-boundary-proxy.mjs scripts/probe-api.mjs scripts/project-opencode-global-config.mjs scripts/runtime-manager-healthcheck.mjs scripts/run-api.sh scripts/run-api-boundary-proxy.sh scripts/run-dashboard.sh scripts/run-gateway.sh scripts/run-restore-maintenance.sh scripts/recover-restore-maintenance.sh scripts/start-opencode-web.sh scripts/start-runtime-opencode-web.sh scripts/start-vscode.sh scripts/wait-for-opencode.sh scripts/start-ttyd.sh scripts/healthcheck.sh scripts/runtime-healthcheck.sh scripts/runtime-entrypoint.sh scripts/validate-gateway-config.sh scripts/validate-api-boundary.sh ./scripts/
COPY --chown=root:root --chmod=0444 supervisord.conf ./supervisord.conf
COPY --chown=root:root --chmod=0555 scripts/run-restore-maintenance.sh scripts/recover-restore-maintenance.sh ./scripts/
COPY --chown=root:root --chmod=0555 scripts/validate-vault-job-secret-root.sh ./scripts/validate-vault-job-secret-root.sh
# Nginx resolves includes from `/app/nginx` during build validation and runtime
# startup, so copy its primary configuration and declared include set together.
COPY --chown=appuser:appuser nginx/gateway.conf nginx/proxy-common.conf nginx/proxy-dashboard.conf nginx/proxy-opencode.conf nginx/proxy-oauth-callback.conf nginx/proxy-vscode.conf ./nginx/
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
# OpenCode initialization reads these authoritative declarations from disk.
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

# Named volumes and runtime state must be writable by unprivileged services on
# first start, rather than relying on root-created directories.
RUN mkdir -p /app/config /app/.ingenium/logs /app/.opencode/skills /workspace && chown -R appuser:appuser /app/config /app/.ingenium /app/.opencode /app/.opencode/skills /workspace
# OpenCode persists configuration and state under appuser's home directory.
RUN mkdir -p /home/appuser/.config/opencode /home/appuser/.local/share/opencode/log && chown -R appuser:appuser /home/appuser
# Docker initializes an empty named volume from this appuser-owned path. Keep
# code-server state separate from OpenCode state so user data/extensions persist
# without sharing an application data directory.
RUN mkdir -p /home/appuser/vscode-data/user-data /home/appuser/vscode-data/extensions && \
    chown -R appuser:appuser /home/appuser/vscode-data
# Compose overlays `/app/opencode.json` with repository configuration. Keep the
# generated image fallback under `/app/config` when that mount hides the root copy.
 RUN echo '{"$schema":"https://opencode.ai/config.json","skills":{"paths":[".opencode/skills"]},"mcp":{"playwright":{"type":"local","command":["npx","-y","@playwright/mcp@0.0.78","--caps=vision"],"enabled":true},"ingenium":{"type":"local","command":["node","/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],"enabled":true,"environment":{"INGENIUM_API_URL":"http://localhost:4097/api/v1","INGENIUM_API_TIMEOUT":"10000","INGENIUM_CORE_DB_PATH":"/app/.ingenium/data","INGENIUM_PROJECT":"global-default"}}},"plugin":["/app/packages/ingenium-extension/plugins/auto-observer.ts","/app/packages/ingenium-extension/plugins/observer.ts","/app/packages/ingenium-extension/plugins/resource-sync.ts","/app/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs"]}' > /app/config/opencode.container.json && \
  cp /app/config/opencode.container.json /app/opencode.json && \
  chown appuser:appuser /app/config/opencode.container.json /app/opencode.json

FROM runtime-base AS user-runtime
USER appuser
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=90s CMD ["/app/scripts/runtime-healthcheck.sh"]
ENTRYPOINT ["/app/scripts/runtime-entrypoint.sh"]

FROM runtime-base AS runtime-manager
USER appuser
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s CMD ["node", "/app/scripts/runtime-manager-healthcheck.mjs"]
ENTRYPOINT ["node", "/app/services/ingenium-api/dist/scripts/runtime-manager.js"]

FROM runtime-base AS control-plane
ENV INGENIUM_DEPLOYMENT_MODE=control-plane
EXPOSE 3000 4097 1455
ENTRYPOINT ["/app/entrypoint.sh"]

FROM runtime-base AS compatibility
ENV INGENIUM_DEPLOYMENT_MODE=compatibility
EXPOSE 3000 4097 1455
ENTRYPOINT ["/app/entrypoint.sh"]
