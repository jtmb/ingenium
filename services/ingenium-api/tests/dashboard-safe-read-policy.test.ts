import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dashboardSafeReadPolicy,
  isDashboardSafeReadCandidate,
  normalizeDashboardReadPath,
} from "../lib/dashboard-safe-read-policy.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(apiRoot, "../..");

function candidate(method: string, originalUrl: string, headers: Record<string, string> = {}): boolean {
  return isDashboardSafeReadCandidate({ method, originalUrl, url: originalUrl, headers } as never);
}

describe("Dashboard safe-read policy", () => {
  it("reconciles the complete observed 328-GET, 86-state profile", () => {
    expect(dashboardSafeReadPolicy.evidence).toMatchObject({
      runId: "run-20260817T134326Z-324949",
      networkStates: 86,
      observedGetRequests: 328,
      safeGetRequests: 26,
      strictGetRequests: 302,
      observedStrictNonGetRequests: 51,
      maxSinglePageFanout: 12,
      maxSinglePageApiRequests: 13,
      humanPacedTransitionIntervalMs: 10000,
    });
    expect(dashboardSafeReadPolicy.safeRoutes).toHaveLength(9);
    expect(dashboardSafeReadPolicy.safeRoutes.reduce((total, route) => total + route.observedCount, 0)).toBe(26);
    expect(dashboardSafeReadPolicy.observedStrictRoutes.reduce((total, route) => total + route.observedCount, 0)).toBe(302);
  });

  it("matches only explicit normalized GET routes and one optional trailing slash", () => {
    const taskId = "3f68f539-3a14-42dc-970f-26a40f1c4874";
    for (const path of [
      "/api/v1/projects/global-default/detail",
      "/api/v1/context/conversations?project=global-default&limit=20",
      `/api/v1/tasks/${taskId}`,
      "/api/v1/usage/events?from=2026-08-01T00%3A00%3A00Z&to=2026-08-02T00%3A00%3A00Z",
    ]) {
      expect(candidate("GET", path), path).toBe(true);
      expect(candidate("GET", `${path.split("?")[0]}/${path.includes("?") ? `?${path.split("?")[1]}` : ""}`), path).toBe(true);
    }
    expect(candidate("GET", "/api/v1/projects//")).toBe(false);
  });

  it("keeps HEAD, sensitive, streaming, upstream, expensive, and unknown routes strict", () => {
    const strict = [
      ["HEAD", "/api/v1/projects"],
      ["POST", "/api/v1/projects"],
      ["GET", "/api/v1/auth/session"],
      ["GET", "/api/v1/auth/sessions"],
      ["GET", "/api/v1/auth/tokens"],
      ["GET", "/api/v1/opencode/sessions/session/events"],
      ["GET", "/api/v1/opencode/events"],
      ["GET", "/api/v1/opencode/providers"],
      ["GET", "/api/v1/settings/provider-configs"],
      ["GET", "/api/v1/synthesis/status"],
      ["GET", "/api/v1/mcp-tools/report"],
      ["GET", "/api/v1/usage/export"],
      ["GET", "/api/v1/backups"],
      ["GET", "/api/v1/backups/3f68f539-3a14-42dc-970f-26a40f1c4874/download"],
      ["GET", "/api/v1/docs/spaces/1/export"],
      ["GET", "/api/v1/logs"],
      ["GET", "/api/v1/context/search"],
      ["GET", "/api/v1/unknown"],
      ["GET", "/api/v1/tasks/notifications"],
      ["GET", "/api/v1/projects"],
      ["GET", "/api/v1/organizations"],
      ["GET", "/api/v1/runtimes/browser/status"],
      ["GET", "/api/v1/runtimes/browser/workspaces"],
      ["GET", "/api/v1/docs/spaces"],
      ["GET", "/api/v1/mcp-servers"],
      ["GET", "/api/v1/mcp-servers/tools"],
      ["GET", "/api/v1/mcp-tools"],
      ["GET", "/api/v1/personality"],
      ["GET", "/api/v1/usage/breakdown"],
    ];
    for (const [method, path] of strict) expect(candidate(method!, path!), `${method} ${path}`).toBe(false);
    expect(candidate("POST", "/api/v1/projects", { "x-http-method-override": "GET" })).toBe(false);
  });

  it("rejects encoded, control, separator, and dot-segment path ambiguity", () => {
    for (const path of [
      "/api/v1/pro%6aects",
      "/api/v1/projects%2f",
      "/api/v1/projects/%2e%2e/projects",
      "/api/v1/projects/%5cdetail",
      "/api/v1/projects/%00/detail",
      "/api/v1/projects/../projects",
      "/api/v1/projects\\detail",
      "/api/v1/projects\u0000",
    ]) expect(candidate("GET", path), path).toBe(false);
    expect(normalizeDashboardReadPath("/api/v1/projects?next=/../tokens")).toBe("/api/v1/projects");
  });

  it("verifies every evidence route registration and generated Nginx parity", () => {
    const apiServer = readFileSync(resolve(apiRoot, "scripts/api-server.ts"), "utf8");
    for (const route of [...dashboardSafeReadPolicy.safeRoutes, ...dashboardSafeReadPolicy.observedStrictRoutes]) {
      expect(readFileSync(resolve(apiRoot, route.source), "utf8"), route.template).toContain(route.registration);
      expect(apiServer, route.mount).toContain(`app.use("${route.mount}"`);
    }
    execFileSync(process.execPath, [
      resolve(repositoryRoot, "scripts/generate-dashboard-safe-read-policy.mjs"),
      "--check",
      resolve(apiRoot, "config/dashboard-safe-reads.json"),
      resolve(repositoryRoot, "nginx/dashboard-safe-reads-map.conf"),
    ]);
    expect(apiServer.indexOf("app.use(authPreflightReadRateLimit);")).toBeLessThan(apiServer.indexOf("app.use(rateLimit);"));
    expect(apiServer.indexOf("app.use(rateLimit);")).toBeLessThan(apiServer.indexOf("app.use(authMiddleware);"));
    expect(apiServer.indexOf("app.use(authMiddleware);")).toBeLessThan(apiServer.indexOf("app.use(recordCandidateAuthenticationFailure);"));
    expect(apiServer.indexOf("app.use(recordCandidateAuthenticationFailure);")).toBeLessThan(apiServer.indexOf("app.use(authenticatedReadRateLimit);"));
  });
});
