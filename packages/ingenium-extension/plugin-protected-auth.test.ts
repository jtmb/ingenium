import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "p".repeat(32);
const project = "protected-plugin-project";
let worktree = "";
let server: Server | undefined;
let apiUrl = "";
let originalApiUrl: string | undefined;
let originalProject: string | undefined;
let originalToken: string | undefined;
let originalTokenFile: string | undefined;
let remainingPreflightFailures = 0;
let preflightFailureStatus = 503;
let hangingPreflightAttempts = 0;

interface RequestRecord {
  path: string;
  authenticated: boolean;
}

const requests: RequestRecord[] = [];

function writeProtectedFallbackToken(): void {
  const directory = join(worktree, ".opencode");
  mkdirSync(directory, { recursive: true });
  const tokenPath = join(directory, ".ingenium-api-token");
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

beforeEach(async () => {
  originalApiUrl = process.env.INGENIUM_API_URL;
  originalProject = process.env.INGENIUM_PROJECT;
  originalToken = process.env.INGENIUM_API_TOKEN;
  originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  delete process.env.INGENIUM_API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  process.env.INGENIUM_PROJECT = project;
  worktree = mkdtempSync(join(tmpdir(), "ingenium-plugin-protected-auth-"));
  writeProtectedFallbackToken();
  requests.splice(0);
  server = createServer((request, response) => {
    requests.push({
      path: request.url ?? "",
      authenticated: request.headers.authorization === `Bearer ${token}`,
    });
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "UNAUTHORIZED" } }));
      return;
    }
    if (request.url === "/api/v1/auth/preflight" && hangingPreflightAttempts > 0) {
      hangingPreflightAttempts -= 1;
      return;
    }
    if (request.url === "/api/v1/auth/preflight" && remainingPreflightFailures > 0) {
      remainingPreflightFailures -= 1;
      response.writeHead(preflightFailureStatus, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { detail: `startup diagnostic ${token}` } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url?.startsWith("/api/v1/synthesis/run")) {
      response.end(JSON.stringify({ data: { processed: 0 } }));
      return;
    }
    if (request.url?.startsWith("/api/v1/extraction/run")) {
      response.end(JSON.stringify({ data: { created: 0 } }));
      return;
    }
    response.end(JSON.stringify({ data: {} }));
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  process.env.INGENIUM_API_URL = apiUrl;
  remainingPreflightFailures = 0;
  preflightFailureStatus = 503;
  hangingPreflightAttempts = 0;
  vi.resetModules();
});

afterEach(async () => {
  await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
  if (originalApiUrl === undefined) delete process.env.INGENIUM_API_URL;
  else process.env.INGENIUM_API_URL = originalApiUrl;
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
  server = undefined;
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("packaged extension plugin protected API requests", () => {
  it("uses the worktree protected bearer for resource sync, extraction, and observer lifecycle calls", async () => {
    const { ResourceSyncPlugin } = await import("./resource-sync.js");
    const { AutoObserverPlugin } = await import("./auto-observer.js");
    const { ObserverPlugin } = await import("./observer.js");
    const log = vi.fn();

    await ResourceSyncPlugin({ worktree, client: { app: { log } } });
    const autoObserver = await AutoObserverPlugin({ worktree, client: { app: { log } } });
    await autoObserver.event({ event: { type: "session.idle" } });
    const observer = await ObserverPlugin({ worktree, client: { app: { log } } });
    await observer.event({ event: { type: "session.created", session: { id: "session-1" } } });

    expect(requests.length).toBeGreaterThanOrEqual(5);
    expect(requests.every((request) => request.authenticated)).toBe(true);
    expect(requests.map((request) => request.path)).toEqual(expect.arrayContaining([
      "/api/v1/projects",
      `/api/v1/extraction/run?project=${project}`,
      expect.stringMatching(new RegExp(`^/api/v1/pipeline/events\\?project=${project}`)),
      expect.stringMatching(new RegExp(`^/api/v1/synthesis/run\\?project=${project}`)),
    ]));
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });

  it("recovers a cold-start project readiness race on the next session event without leaking diagnostics", async () => {
    remainingPreflightFailures = 3;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.fn().mockRejectedValue(new Error(`logger rejected ${token}`));
    const { ResourceSyncPlugin } = await import("./resource-sync.js");

    const plugin = await ResourceSyncPlugin({ worktree, client: { app: { log } } });
    await plugin.event({ event: { type: "session.created" } });

    const diagnostic = JSON.stringify(log.mock.calls);
    expect(diagnostic).toContain("extension_project_init: unavailable");
    expect(diagnostic).toContain("extension_project_init: recovered");
    expect(diagnostic).not.toContain(token);
    expect(diagnostic).not.toContain(apiUrl);
    expect(diagnostic).not.toContain("startup diagnostic");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(requests.filter((request) => request.path === "/api/v1/auth/preflight")).toHaveLength(4);
    expect(requests.every((request) => request.authenticated)).toBe(true);
    expect(log.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps authentication and timeout-shaped startup failures out of process output", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.fn();
    preflightFailureStatus = 401;
    remainingPreflightFailures = 1;
    const { ResourceSyncPlugin } = await import("./resource-sync.js");

    await expect(ResourceSyncPlugin({ worktree, client: { app: { log } } })).resolves.toBeDefined();
    expect(JSON.stringify(log.mock.calls)).toContain("extension_project_init: authentication");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    const timeoutStdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const timeoutStderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const timeoutLog = vi.fn();
    hangingPreflightAttempts = 3;
    const { ResourceSyncPlugin: TimeoutResourceSyncPlugin } = await import("./resource-sync.js");

    await expect(TimeoutResourceSyncPlugin({ worktree, client: { app: { log: timeoutLog } } })).resolves.toBeDefined();
    expect(JSON.stringify(timeoutLog.mock.calls)).toContain("extension_project_init: unavailable");
    expect(JSON.stringify(timeoutLog.mock.calls)).not.toContain(token);
    expect(JSON.stringify(timeoutLog.mock.calls)).not.toContain(apiUrl);
    expect(timeoutStdout).not.toHaveBeenCalled();
    expect(timeoutStderr).not.toHaveBeenCalled();
  });
});
