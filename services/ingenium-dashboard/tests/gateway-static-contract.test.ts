import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), "utf8");
const dockerfile = read("Dockerfile");
const compose = read("docker-compose.yml");
const dashboardRunner = read("scripts/run-dashboard.sh");
const healthcheck = read("scripts/healthcheck.sh");
const gateway = read("nginx/gateway.conf");
const apiConfig = read("services/ingenium-api/config/index.ts");
const generatedSafeReads = read("nginx/dashboard-safe-reads-map.conf");
const safeReadPolicy = JSON.parse(read("services/ingenium-api/config/dashboard-safe-reads.json")) as {
  evidence: { runId: string; networkStates: number; observedGetRequests: number; safeGetRequests: number; strictGetRequests: number; observedStrictNonGetRequests: number; maxSinglePageFanout: number; maxSinglePageApiRequests: number; humanPacedTransitionIntervalMs: number };
  safeRoutes: Array<{ template: string; observedCount: number }>;
  observedStrictRoutes: Array<{ template: string; observedCount: number }>;
};
const dashboardProxy = read("nginx/proxy-dashboard.conf");
const vscodeProxy = read("nginx/proxy-vscode.conf");
const compatibilityAliases = read("nginx/runtime-aliases-compatibility.conf");
const productionAliases = read("nginx/runtime-aliases-production.conf");
const unavailableAlias = read("nginx/runtime-alias-unavailable-location.conf");

function blockFor(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing block: ${marker}`);

  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed block: ${marker}`);
}

const dashboardServer = blockFor(gateway, "server {\n        listen 3000 default_server;");

function locationBlock(location: string): string {
  return blockFor(dashboardServer, location);
}

function dashboardLocationFor(requestTarget: string): string {
  const pathname = new URL(requestTarget, "http://gateway.local").pathname;
  if (pathname.startsWith("/_next/static/")) return locationBlock("location ^~ /_next/static/ {");
  if (pathname.startsWith("/api/v1/")) return locationBlock("location ^~ /api/v1/ {");
  return locationBlock("location / {");
}

describe("dashboard deployment static contract", () => {
  it("runs the deployment validator before building the dashboard", () => {
    expect(dockerfile.indexOf("RUN sh scripts/validate-deployment-config.sh"))
      .toBeLessThan(dockerfile.indexOf("RUN npm run build"));
  });

  it("copies standalone public assets into the runtime image", () => {
    expect(dockerfile).toContain(
      "COPY --from=builder --chown=root:root /app/services/ingenium-dashboard/public ./services/ingenium-dashboard/public",
    );
  });

  it("starts with the protected token-file and local gateway contract", () => {
    expect(compose).toContain('- "3000:3000"');
    expect(compose).toContain('- "127.0.0.1:4097:4097"');
    expect(compose).not.toContain("3002");
    expect(compose).not.toMatch(/(?:^|\n)\s*-\s*"?(?:127\.0\.0\.1:)?409[89]:409[89]/);
    expect(dashboardRunner).toContain('INGENIUM_DASHBOARD_BOOTSTRAP_TOKEN_FILE="$token_file"');
    expect(dashboardRunner).toContain("exec env -i");
    expect(dashboardRunner).not.toContain('INGENIUM_API_TOKEN="$token_file"');
    expect(dashboardRunner).toContain("node /app/services/ingenium-dashboard/server.js");
  });

  it("separates immutable assets, safe API reads, and strict dashboard traffic", () => {
    const assets = locationBlock("location ^~ /_next/static/ {");
    const api = locationBlock("location ^~ /api/v1/ {");
    const dynamic = locationBlock("location / {");

    expect(dashboardServer).toContain("server_name _;");
    expect(dashboardServer).not.toContain("return 444;");
    expect(assets).not.toContain("limit_req");
    expect(assets).toContain("limit_conn gateway_conn 16;");
    expect(assets).toContain("proxy_pass http://ingenium_dashboard;");
    expect(assets).toContain("include /app/nginx/proxy-common.conf;");
    expect(assets).toContain("include /app/nginx/proxy-dashboard.conf;");
    expect(assets).not.toMatch(/limit_except|\$request_method/);
    expect(assets).not.toContain("proxy_hide_header Cache-Control;");
    expect(assets).not.toContain("add_header Cache-Control");

    expect(dynamic).toContain("limit_req zone=dashboard_request burst=60 nodelay;");
    expect(api).toContain("limit_req zone=dashboard_api_read burst=360 nodelay;");
    expect(api).toContain("limit_req zone=dashboard_api_strict burst=60 nodelay;");
    expect(api).not.toContain("limit_req zone=dashboard_request");
    expect(gateway).toContain("limit_req_zone $dashboard_api_read_limit_key zone=dashboard_api_read:10m rate=60r/s;");
    expect(gateway).toContain("limit_req_zone $dashboard_api_strict_limit_key zone=dashboard_api_strict:10m rate=30r/s;");
    expect(gateway).toContain("include /app/nginx/dashboard-safe-reads-map.conf;");
    expect(gateway).toContain("add_header Retry-After \"1\" always;");
    for (const requestTarget of [
      "/",
      "/?settings",
      "/?_rsc",
      "/api",
      "/projects",
      "/_next/data/build/projects.json",
    ]) {
      expect(dashboardLocationFor(requestTarget)).toBe(dynamic);
    }
    expect(dashboardLocationFor("/api/v1/projects")).toBe(api);
    for (const requestTarget of [
      "/_next/static/chunks/app.js",
      "/_next/static/chunks/app.js?cache-bust=1",
    ]) {
      expect(dashboardLocationFor(requestTarget)).toBe(assets);
    }
    for (const requestTarget of [
      "/_next/static",
      "/_next/staticish/chunks/app.js",
      "/_next/static/../data/build/projects.json",
      "/_next/static/%2e%2e/data/build/projects.json",
    ]) {
      expect(dashboardLocationFor(requestTarget)).toBe(dynamic);
    }
  });

  it("models the observed safe-read sweep without weakening protected requests", () => {
    const safeBurst = Number(gateway.match(/dashboard_api_read burst=(\d+) nodelay/)?.[1]);
    const strictBurst = Number(gateway.match(/dashboard_api_strict burst=(\d+) nodelay/)?.[1]);
    const strictSustainedRate = Number(gateway.match(/dashboard_api_strict:10m rate=(\d+)r\/s/)?.[1]);
    const apiStrictRequestsPerMinute = Number(apiConfig.match(/INGENIUM_API_RATE_LIMIT \?\? "(\d+)"/)?.[1]);

    expect(safeReadPolicy.evidence).toEqual({ runId: "run-20260817T134326Z-324949", networkStates: 86, observedGetRequests: 329, safeGetRequests: 26, strictGetRequests: 303, observedStrictNonGetRequests: 51, maxSinglePageFanout: 12, maxSinglePageApiRequests: 13, humanPacedTransitionIntervalMs: 10000 });
    expect(safeReadPolicy.safeRoutes).toHaveLength(9);
    expect(safeReadPolicy.safeRoutes.reduce((total, route) => total + route.observedCount, 0)).toBe(26);
    expect(safeReadPolicy.observedStrictRoutes.reduce((total, route) => total + route.observedCount, 0)).toBe(303);
    expect(safeReadPolicy.evidence.maxSinglePageFanout).toBeLessThanOrEqual(strictBurst);
    expect(safeReadPolicy.evidence.maxSinglePageApiRequests).toBeLessThanOrEqual(strictBurst);
    expect(safeReadPolicy.evidence.maxSinglePageApiRequests * (1000 / safeReadPolicy.evidence.humanPacedTransitionIntervalMs)).toBeLessThanOrEqual(strictSustainedRate);
    expect(safeReadPolicy.evidence.maxSinglePageApiRequests * (60_000 / safeReadPolicy.evidence.humanPacedTransitionIntervalMs)).toBeLessThanOrEqual(apiStrictRequestsPerMinute);
    const humanPacedStrictRequestsPerMinute = (safeReadPolicy.evidence.strictGetRequests + safeReadPolicy.evidence.observedStrictNonGetRequests)
      / safeReadPolicy.evidence.networkStates * (60_000 / safeReadPolicy.evidence.humanPacedTransitionIntervalMs);
    expect(humanPacedStrictRequestsPerMinute).toBeLessThanOrEqual(apiStrictRequestsPerMinute);
    expect(safeBurst).toBe(360);
    expect(strictBurst).toBe(60);
    expect(generatedSafeReads).toContain("map $request_uri $dashboard_api_raw_path {");
    expect(generatedSafeReads).toContain('map "$request_method|$uri|$dashboard_api_raw_path" $dashboard_api_limit_class {');
    expect(generatedSafeReads).toContain("default strict;");
    expect(generatedSafeReads).toContain("^GET\\|");
    expect(generatedSafeReads).toContain("\\|\\1$");
    expect(generatedSafeReads).not.toContain("HEAD");
    expect(generatedSafeReads).not.toContain("?!");
    for (const protectedPath of [
      "/api/v1/auth/session",
      "/api/v1/settings/provider-configs",
      "/api/v1/logs",
      "/api/v1/backups",
      "/api/v1/projects",
      "/api/v1/organizations",
      "/api/v1/runtimes/browser/status",
      "/api/v1/runtimes/browser/workspaces",
      "/api/v1/docs/spaces",
      "/api/v1/mcp-servers",
      "/api/v1/mcp-servers/tools",
      "/api/v1/mcp-tools",
      "/api/v1/personality",
      "/api/v1/usage/breakdown",
    ]) expect(safeReadPolicy.observedStrictRoutes.map((route) => route.template)).toContain(protectedPath);
    for (const removedPattern of [
      "(/api/v1/projects/?)",
      "(/api/v1/organizations/?)",
      "(/api/v1/runtimes/browser/status/?)",
      "(/api/v1/runtimes/browser/workspaces/?)",
      "(/api/v1/docs/spaces/?)",
      "(/api/v1/mcp-servers/?)",
      "(/api/v1/mcp-servers/tools/?)",
      "(/api/v1/mcp-tools/?)",
      "(/api/v1/personality/?)",
      "(/api/v1/usage/breakdown/?)",
    ]) expect(generatedSafeReads).not.toContain(removedPattern);

    const clientCounts = new Map<string, number>();
    const allowStrict = (client: string) => {
      const count = (clientCounts.get(client) ?? 0) + 1;
      clientCounts.set(client, count);
      return count <= strictBurst;
    };
    for (let index = 0; index < strictBurst; index += 1) expect(allowStrict("client-a")).toBe(true);
    expect(allowStrict("client-a")).toBe(false);
    expect(allowStrict("client-b")).toBe(true);

    expect(dockerfile).toContain("scripts/generate-dashboard-safe-read-policy.mjs");
    expect(dockerfile).toContain("nginx/dashboard-safe-reads-map.conf");
    expect(dockerfile).toContain("services/ingenium-api/config/dashboard-safe-reads.json ./services/ingenium-api/dist/config/dashboard-safe-reads.json");
  });

  it("uses the dashboard proxy policy for immutable assets", () => {
    expect(dashboardProxy).toContain("proxy_set_header Host $host;");
    expect(dashboardProxy).toContain('proxy_set_header Authorization "";');
    expect(dashboardProxy).toContain('proxy_set_header X-Ingenium-Authenticated-User "";');
    expect(dashboardProxy).toContain('proxy_set_header Forwarded "";');
    expect(dashboardProxy).not.toContain("proxy_hide_header Content-Security-Policy;");
    expect(dashboardProxy).not.toContain("proxy_hide_header Cache-Control;");
  });

  it("keeps code-server's upstream CSP while allowing only its worker iframe and local dashboard parents", () => {
    expect(vscodeProxy).toContain("proxy_hide_header X-Frame-Options;");
    expect(vscodeProxy).not.toContain("proxy_hide_header Content-Security-Policy;");
    expect(vscodeProxy).toContain(
      "add_header Content-Security-Policy \"frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000\" always;",
    );
    expect(vscodeProxy).not.toContain("frame-ancestors *");
    expect(vscodeProxy).not.toContain("http://[::1]:3000");
    expect(vscodeProxy).not.toContain("http://192.168.");
  });

  it("uses one identical no-store 404 for production aliases and no absent upstream proxy", () => {
    expect(gateway).toContain("include /run/ingenium-gateway/runtime-aliases.conf;");
    expect(productionAliases).toContain("server_name opencode.localhost cli.localhost vscode.localhost;");
    expect(productionAliases.match(/include \/app\/nginx\/runtime-alias-unavailable-location\.conf;/g)).toHaveLength(1);
    expect(productionAliases).not.toContain("proxy_pass");
    expect(unavailableAlias).toContain('return 404 "Direct local runtime aliases are unavailable in production. Open the Ingenium Dashboard and choose an authorized workspace.\\n";');
    expect(healthcheck).toContain('expected="$(printf \'%s\\n|404\' "$expected_body")"');
    expect(unavailableAlias).toContain('add_header Cache-Control "no-store" always;');
    expect(unavailableAlias).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(unavailableAlias).toContain("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    expect(unavailableAlias).not.toMatch(/runtime[_ -]?id|backend|container|workspace[_ -]?id/i);
  });

  it("retains healthy compatibility proxy aliases", () => {
    expect(compatibilityAliases).toContain("proxy_pass http://opencode_web;");
    expect(compatibilityAliases).toContain("proxy_pass http://opencode_cli;");
    expect(compatibilityAliases).toContain("proxy_pass http://vscode;");
    expect(compatibilityAliases).not.toContain("runtime-alias-unavailable-location.conf");
  });
});
