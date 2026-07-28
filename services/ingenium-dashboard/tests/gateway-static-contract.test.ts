import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const compose = read("docker-compose.yml");
const dockerfile = read("Dockerfile");
const entrypoint = read("scripts/docker-entrypoint.sh");
const apiBoundary = read("scripts/api-boundary-proxy.mjs");
const apiBoundaryRunner = read("scripts/run-api-boundary-proxy.sh");
const apiRunner = read("scripts/run-api.sh");
const dashboardRunner = read("scripts/run-dashboard.sh");
const dashboardLoader = read("scripts/run-dashboard.mjs");
const startOpenCode = read("scripts/start-opencode-web.sh");
const supervisor = read("supervisord.conf");
const gateway = read("nginx/gateway.conf");
const dashboardProxy = read("nginx/proxy-dashboard.conf");
const opencodeProxy = read("nginx/proxy-opencode.conf");
const oauthCallbackProxy = read("nginx/proxy-oauth-callback.conf");
const healthcheck = read("scripts/healthcheck.sh");
const apiProbe = read("scripts/probe-api.mjs");
const windowsTransportProbe = read("scripts/windows-loopback-transport.ps1");

describe("Phase 2E — static gateway contracts", () => {
  it("serves forwarded Windows hosts through the dashboard fallback without Basic auth", () => {
    expect(gateway).toMatch(
      /server \{\s*listen 3000 default_server;\s*listen \[::\]:3000 default_server;\s*server_name _;[\s\S]*?proxy_pass http:\/\/ingenium_dashboard;/,
    );
    expect(gateway).not.toContain("return 444;");
    expect(gateway).toContain("server_name opencode.localhost;");
    expect(gateway).toContain("server_name cli.localhost;");
    expect(gateway).not.toContain("auth_basic");
    expect(gateway).not.toContain("auth_delay");
    expect(gateway).not.toContain("htpasswd");
    expect(gateway).toContain("proxy_set_header X-Ingenium-Authenticated-User local-gateway;");
    expect(gateway).toContain("map $http_origin $ttyd_websocket_upstream_host {");
    expect(gateway).toContain('"http://localhost:3000" "localhost:3000";');
    expect(gateway).toContain('"http://127.0.0.1:3000" "127.0.0.1:3000";');
    expect(gateway).toContain('"http://cli.localhost:3000" "cli.localhost:3000";');
  });

  it("keeps private listeners off the host publication and binds them to loopback", () => {
    expect(compose).toContain('- "3000:3000"');
    expect(compose).not.toContain("127.0.0.1:3000:3000");
    expect(compose).toContain('- "127.0.0.1:4097:4097"');
    expect(compose).toContain('- "127.0.0.1:1455:1455"');
    expect(compose).not.toContain("1455:4097");
    expect(compose).not.toMatch(/(?:^|\n)\s*-\s*"?(?:127\.0\.0\.1:)?409[89]:409[89]/);
    expect(dockerfile).toMatch(/EXPOSE 3000 4097 1455/);
    expect(dockerfile).not.toMatch(/^EXPOSE.*409[89]/m);

    expect(startOpenCode).toContain("opencode web --port 4098 --hostname 127.0.0.1");
    expect(startOpenCode).toContain('INGENIUM_API_TOKEN_FILE="/workspace/.opencode/.ingenium-api-token"');
    expect(startOpenCode).toContain("INGENIUM_OPENCODE_START_CLEAN_ENV=\"1\"");
    expect(startOpenCode).toContain("attempts=10");
    expect(startOpenCode).toContain("node /app/scripts/probe-api.mjs");
    expect(read("supervisord.conf")).toContain("command=/app/scripts/start-opencode-web.sh");
    expect(read("scripts/start-ttyd.sh")).toContain("--interface 127.0.0.1");
  });

  it("copies dashboard public assets beside the standalone server", () => {
    expect(dockerfile).toContain(
      "COPY --from=builder --chown=appuser:appuser /app/services/ingenium-dashboard/public ./services/ingenium-dashboard/public",
    );
  });

  it("keeps Windows forwarding verification focused on unauthenticated local gateway routes", () => {
    expect(windowsTransportProbe).toContain('Name = "dashboard-ipv4"');
    expect(windowsTransportProbe).toContain('Name = "dashboard-ipv6"');
    expect(windowsTransportProbe).toContain('HostHeader = "host.docker.internal:$DashboardPort"');
    expect(windowsTransportProbe).toContain('/api/v1/projects');
    expect(windowsTransportProbe).toContain('Name = "opencode-web-root"');
    expect(windowsTransportProbe).toContain('Name = "opencode-cli-root"');
    expect(windowsTransportProbe).toContain("$_.Status -ne 200 -or $_.Authentication");
    expect(windowsTransportProbe).toContain('Name "api-boundary-without-bearer"');
    expect(windowsTransportProbe).toContain("Get-WslLoopbackApiStatus");
    expect(windowsTransportProbe).toContain("$apiBoundaryStatus -ne 401");
    expect(windowsTransportProbe).toContain("foreach ($port in 4098, 4099)");
    expect(windowsTransportProbe).toContain("$null -ne $_.Status");
    expect(windowsTransportProbe).not.toContain("INGENIUM_GATEWAY_PASSWORD");
    expect(windowsTransportProbe).not.toMatch(/netsh|New-NetFirewallRule|Set-NetFirewallProfile|Add-Net/);
  });

  it("keeps the fixed OAuth callback listener exact and credential-free", () => {
    expect(gateway).toContain("listen 1455 default_server;");
    expect(gateway).toContain("location = /auth/callback");
    expect(gateway).toContain("if ($request_method != GET) {");
    expect(gateway).toContain("proxy_pass http://ingenium_api;");
    expect(gateway).toContain("include /app/nginx/proxy-oauth-callback.conf;");
    expect(gateway).toContain("return 404;");
    expect(oauthCallbackProxy).toContain('proxy_set_header Authorization "";');
    expect(oauthCallbackProxy).toContain('proxy_set_header Upgrade "";');
    expect(oauthCallbackProxy).toContain('proxy_set_header Connection "";');
    expect(oauthCallbackProxy).toContain("proxy_pass_request_body off;");
  });

  it("requires the server-side OpenCode password but no browser gateway password", () => {
    expect(compose).toContain(
      "OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD:?OPENCODE_SERVER_PASSWORD is required}",
    );
    expect(compose).not.toContain("INGENIUM_GATEWAY_PASSWORD");
    expect(compose).not.toContain("INGENIUM_GATEWAY_BCRYPT_COST");
    expect(compose).not.toContain("seccomp=unconfined");
    expect(compose).not.toMatch(/^\s*security_opt:/m);
    expect(compose).not.toMatch(/sudo/i);
    expect(dockerfile).not.toMatch(/sudo|NOPASSWD:ALL/i);

    expect(entrypoint).toContain("OPENCODE_SERVER_PASSWORD environment variable is required");
    expect(entrypoint).not.toContain("INGENIUM_GATEWAY_PASSWORD");
    expect(entrypoint).not.toContain("htpasswd");
  });

  it("keeps the private API behind an authenticated boundary", () => {
    expect(compose).toContain("INGENIUM_API_TOKEN=${INGENIUM_API_TOKEN:-}");
    expect(compose).toContain("INGENIUM_API_TOKEN_FILE=${INGENIUM_API_TOKEN_FILE:-}");
    expect(compose).toContain(
      "DASHBOARD_ALLOWED_ORIGINS=${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}",
    );
    expect(compose).toContain("INGENIUM_API_PORT=4096");
    expect(compose).not.toContain("4096:4096");

    expect(supervisor).toContain("[program:ingenium-api-boundary]");
    expect(supervisor).toContain("command=/app/scripts/run-api-boundary-proxy.sh");
    expect(apiBoundaryRunner).toContain('INGENIUM_API_TOKEN_FILE="$token_file"');
    expect(apiBoundaryRunner).toContain('INGENIUM_API_PROXY_PORT="4097"');
    expect(apiBoundaryRunner).toContain('INGENIUM_API_UPSTREAM_PORT="4096"');
    expect(apiBoundary).toContain("const providedToken = incomingBearerToken(request.headers);");
    expect(apiBoundary).toContain("if (!apiTokensEqual(providedToken, token)) {");
    expect(apiBoundary).toContain("forwarded.authorization = `Bearer ${token}`;");
  });

  it("seeds OpenCode MCP with the protected container token-file contract", () => {
    expect(entrypoint).toContain('RUNTIME_SECRET_DIR="/run/ingenium-secrets"');
    expect(entrypoint).toContain('RUNTIME_API_TOKEN_FILE="${RUNTIME_SECRET_DIR}/api-token"');
    expect(entrypoint).toContain('chmod 0600 "$runtime_token_tmp"');
    expect(entrypoint).toContain('mv -f "$runtime_token_tmp" "$RUNTIME_API_TOKEN_FILE"');
    expect(entrypoint).toContain("unset INGENIUM_API_TOKEN");
    expect(entrypoint).toContain('export INGENIUM_API_TOKEN_FILE="$RUNTIME_API_TOKEN_FILE"');

    const tokenExportOffset = entrypoint.indexOf('export INGENIUM_API_TOKEN_FILE="$RUNTIME_API_TOKEN_FILE"');
    const mcpSeedOffset = entrypoint.indexOf('"ingenium": {');
    expect(tokenExportOffset).toBeGreaterThanOrEqual(0);
    expect(mcpSeedOffset).toBeGreaterThan(tokenExportOffset);
    expect(entrypoint).toContain('"command": ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"]');
    expect(entrypoint).toContain('"INGENIUM_API_URL": "http://localhost:4097/api/v1"');
    expect(entrypoint).toContain('"INGENIUM_PROJECT": "global-default"');
    expect(apiRunner).toContain('INGENIUM_API_TOKEN_FILE="$token_file"');
    expect(dashboardRunner).toContain('INGENIUM_API_TOKEN_FILE="$token_file"');
    expect(apiRunner).toContain(
      'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"',
    );
    expect(dashboardRunner).toContain(
      'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"',
    );
    expect(dashboardLoader).not.toContain("process.env.INGENIUM_API_TOKEN");
    expect(dashboardLoader).toContain(
      'await import("/app/services/ingenium-dashboard/server.js");',
    );
  });

  it("uses gateway-only ttyd health identity instead of probing the private port", () => {
    expect(healthcheck).toContain(
      "require_ttyd_gateway_health",
    );
    expect(healthcheck).toContain("node /app/scripts/probe-api.mjs");
    expect(apiProbe).toContain("Authorization: `Bearer ${token}`");
    expect(healthcheck).toContain("http://127.0.0.1:3000/_ingenium/health");
    expect(healthcheck).not.toContain("http://127.0.0.1:4099/");
    expect(gateway).toContain(
      "proxy_set_header X-Ingenium-Authenticated-User healthcheck;",
    );
    expect(gateway).toContain("allow 127.0.0.1;");
    expect(gateway).toContain("deny all;");
  });

  it("forwards a checked WebSocket Origin only for trusted local origins", () => {
    expect(read("scripts/start-ttyd.sh")).toContain("--check-origin");
    expect(gateway).toContain("location = /ws {");
    expect(gateway).toContain('if ($ttyd_websocket_upstream_host = "") {');
    expect(gateway).toContain("return 403;");
    expect(gateway).toContain("proxy_set_header Host $ttyd_websocket_upstream_host;");
    expect(gateway).toContain("proxy_set_header Origin $http_origin;");
    expect(opencodeProxy).not.toContain("proxy_set_header Host");
  });

  it("owns the frame policy and strips browser-controlled identity headers", () => {
    expect(opencodeProxy).toContain("proxy_hide_header Content-Security-Policy;");
    expect(opencodeProxy).toContain("proxy_hide_header X-Frame-Options;");
    expect(opencodeProxy).toContain(
      'add_header Content-Security-Policy "frame-ancestors http://localhost:3000 http://127.0.0.1:3000" always;',
    );
    expect(opencodeProxy).not.toContain(
      'frame-ancestors http://localhost:3000 http://127.0.0.1:3000 http://[::1]:3000',
    );
    expect(opencodeProxy).not.toMatch(/frame-ancestors\s+\*/);

    for (const header of [
      "Authorization",
      "Proxy-Authorization",
      "X-Ingenium-Authenticated-User",
      "X-Forwarded-For",
      "X-Forwarded-Host",
      "X-Forwarded-Proto",
      "X-Real-IP",
      "Forwarded",
    ]) {
      expect(opencodeProxy).toContain(`proxy_set_header ${header} "";`);
    }

    expect(dashboardProxy).toContain('proxy_set_header Authorization "";');
    expect(dashboardProxy).toContain('proxy_set_header X-Ingenium-Authenticated-User "";');
    expect(dashboardProxy).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(dashboardProxy).toContain("proxy_set_header X-Forwarded-Host $host;");
    expect(dashboardProxy).toContain("proxy_set_header X-Forwarded-Proto $scheme;");
    expect(dashboardProxy).toContain("proxy_set_header X-Forwarded-Port $server_port;");
    expect(dashboardProxy).toContain('proxy_set_header Forwarded "";');
  });

  it("isolates normal OpenCode asset and upgrade traffic from dashboard rate bursts", () => {
    expect(gateway).toContain(
      "limit_req_zone $binary_remote_addr zone=dashboard_request:10m rate=30r/s;",
    );
    expect(gateway).toContain(
      "limit_req_zone $opencode_request_limit_key zone=opencode_request:10m rate=30r/s;",
    );
    expect(gateway).toContain("map $http_upgrade $opencode_upgrade_rate_limit_key {");
    expect(gateway).toContain("map $uri $opencode_request_limit_key {");
    expect(gateway).toContain(
      '~^/(?:assets/|_next/|@vite/|node_modules/\\.vite/) "";',
    );
    expect(gateway).toContain("limit_req zone=dashboard_request burst=60 nodelay;");
    expect(gateway).toContain("limit_req zone=opencode_request burst=60 nodelay;");
    expect(gateway).not.toContain("zone=gateway_request");
  });

  it("canonicalizes direct IPv6 loopback dashboard navigation to a valid CSP origin", () => {
    expect(gateway).toContain("map $host $dashboard_ipv6_loopback {");
    expect(gateway).toContain('"::1" 1;');
    expect(gateway).toContain('"[::1]" 1;');
    expect(gateway).toContain("return 308 http://localhost:3000$request_uri;");
  });

  it("routes Nginx errors through the appuser-owned Supervisor log", () => {
    const gatewayErrorLog = "/run/ingenium-gateway/nginx-error.log";

    expect(gateway).toContain(`error_log ${gatewayErrorLog} warn;`);
    expect(gateway).not.toContain("error_log stderr warn;");
    expect(gateway).not.toContain("error_log /dev/stderr");
    expect(supervisor).toContain(`stdout_logfile=${gatewayErrorLog}`);
    expect(entrypoint).toContain(
      'GATEWAY_ERROR_LOG="${GATEWAY_RUNTIME_DIR}/nginx-error.log"',
    );
    expect(entrypoint).toContain(
      'install -o appuser -g appuser -m 0600 /dev/null "$GATEWAY_ERROR_LOG"',
    );
    const validationCommand = "runuser -u appuser -- env -i \\";
    const validationPath = "/app/scripts/validate-gateway-config.sh";
    expect(entrypoint).toContain(validationCommand);
    expect(entrypoint.indexOf(validationPath)).toBeGreaterThan(
      entrypoint.indexOf(validationCommand),
    );
  });
});
