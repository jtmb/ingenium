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
  return pathname.startsWith("/_next/static/")
    ? locationBlock("location ^~ /_next/static/ {")
    : locationBlock("location / {");
}

describe("dashboard deployment static contract", () => {
  it("runs the deployment validator before building the dashboard", () => {
    expect(dockerfile.indexOf("RUN sh scripts/validate-deployment-config.sh"))
      .toBeLessThan(dockerfile.indexOf("RUN npm run build"));
  });

  it("copies standalone public assets into the runtime image", () => {
    expect(dockerfile).toContain(
      "COPY --from=builder --chown=appuser:appuser /app/services/ingenium-dashboard/public ./services/ingenium-dashboard/public",
    );
  });

  it("starts with the protected token-file and local gateway contract", () => {
    expect(compose).toContain('- "3000:3000"');
    expect(compose).toContain('- "127.0.0.1:4097:4097"');
    expect(compose).not.toContain("3002");
    expect(compose).not.toMatch(/(?:^|\n)\s*-\s*"?(?:127\.0\.0\.1:)?409[89]:409[89]/);
    expect(dashboardRunner).toContain('INGENIUM_API_TOKEN_FILE="$token_file"');
    expect(dashboardRunner).toContain("exec env -i");
    expect(dashboardRunner).not.toContain('INGENIUM_API_TOKEN="$token_file"');
    expect(dashboardRunner).toContain("node /app/services/ingenium-dashboard/server.js");
  });

  it("exempts only normalized immutable Next assets from the dashboard request limiter", () => {
    const assets = locationBlock("location ^~ /_next/static/ {");
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
    for (const requestTarget of [
      "/",
      "/?settings",
      "/?_rsc",
      "/api",
      "/api/v1/projects",
      "/projects",
      "/_next/data/build/projects.json",
    ]) {
      expect(dashboardLocationFor(requestTarget)).toBe(dynamic);
    }
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
    for (const host of ["opencode.localhost", "cli.localhost", "vscode.localhost"]) {
      expect(productionAliases).toContain(`server_name ${host};`);
    }
    expect(productionAliases.match(/include \/app\/nginx\/runtime-alias-unavailable-location\.conf;/g)).toHaveLength(3);
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
