import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExtensionProjectStartupError,
  ensureExtensionProject,
  resetEnsuredProjects,
} from "./project-resolver.js";

const token = "r".repeat(32);
const apiBase = "http://api.test/api/v1";
let worktree = "";
let originalProject: string | undefined;
let originalWorkspace: string | undefined;

function writeProtectedToken(directory: string, value = token): void {
  const opencode = join(directory, ".opencode");
  mkdirSync(opencode, { recursive: true });
  const tokenPath = join(opencode, ".ingenium-mcp-credential");
  writeFileSync(tokenPath, `${value}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

beforeEach(() => {
  originalProject = process.env.INGENIUM_PROJECT;
  originalWorkspace = process.env.INGENIUM_WORKSPACE_ID;
  process.env.INGENIUM_PROJECT = "external-startup-project";
  process.env.INGENIUM_WORKSPACE_ID = "workspace-fixture";
  worktree = mkdtempSync(join(tmpdir(), "ingenium-project-readiness-"));
  writeProtectedToken(worktree);
  resetEnsuredProjects();
});

afterEach(() => {
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (originalWorkspace === undefined) delete process.env.INGENIUM_WORKSPACE_ID;
  else process.env.INGENIUM_WORKSPACE_ID = originalWorkspace;
  resetEnsuredProjects();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("extension project startup readiness", () => {
  it("performs a finite authenticated readiness retry before project attestation", async () => {
    let preflightAttempts = 0;
    const sleep = vi.fn(async () => undefined);
    const request = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
      if (path.endsWith("/auth/preflight")) {
        preflightAttempts += 1;
        return new Response(preflightAttempts < 3 ? "not ready" : JSON.stringify({ data: {
          scopes: ["projects:read"], organizationId: "org-id", projectId: "project-id", projectIds: ["project-id"],
          audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: worktree, restartRequiredOnCredentialChange: true,
        } }), { status: preflightAttempts < 3 ? 503 : 200, headers: { "Content-Type": "application/json" } });
      }
      expect(path).toBe("/api/v1/projects/external-startup-project/detail");
      return Response.json({ data: { project: { id: "project-id" } } });
    });

    await expect(ensureExtensionProject(worktree, apiBase, undefined, {
      request: request as unknown as typeof fetch,
      readiness: { attempts: 3, retryDelayMs: 0, sleep },
    })).resolves.toBe("external-startup-project");

    expect(preflightAttempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/api/v1/auth/preflight",
      "/api/v1/auth/preflight",
      "/api/v1/auth/preflight",
      "/api/v1/projects/external-startup-project/detail",
    ]);
  });

  it("fails closed on a 401 preflight without provisioning or leaking protected details", async () => {
    const request = vi.fn(async () => new Response(`denied ${token}`, { status: 401 }));

    await expect(ensureExtensionProject(worktree, apiBase, undefined, {
      request: request as unknown as typeof fetch,
      readiness: { attempts: 3, retryDelayMs: 0 },
    })).rejects.toMatchObject({
      name: "ExtensionProjectStartupError",
      failure: "authentication",
      message: "Unable to establish an extension project connection",
    } satisfies Partial<ExtensionProjectStartupError>);

    expect(request).toHaveBeenCalledTimes(1);
    const error = await ensureExtensionProject(worktree, apiBase, undefined, {
      request: request as unknown as typeof fetch,
      readiness: { attempts: 1, retryDelayMs: 0 },
    }).catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain(apiBase);
  });

  it("does not share a cached authenticated provision between worktrees", async () => {
    const secondWorktree = mkdtempSync(join(tmpdir(), "ingenium-project-readiness-second-"));
    const secondToken = "s".repeat(32);
    writeProtectedToken(secondWorktree, secondToken);
    try {
      const seenTokens: string[] = [];
      const request = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("Authorization") ?? "";
        seenTokens.push(authorization);
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/auth/preflight")) return new Response(JSON.stringify({ data: {
          scopes: ["projects:read"], organizationId: "org-id", projectId: "project-id", projectIds: ["project-id"],
          audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: authorization === `Bearer ${secondToken}` ? secondWorktree : worktree,
          restartRequiredOnCredentialChange: true,
        } }), { status: 200, headers: { "Content-Type": "application/json" } });
        return Response.json({ data: { project: { id: "project-id" } } });
      });

      await ensureExtensionProject(worktree, apiBase, undefined, { request: request as unknown as typeof fetch, readiness: { retryDelayMs: 0 } });
      await ensureExtensionProject(secondWorktree, apiBase, undefined, { request: request as unknown as typeof fetch, readiness: { retryDelayMs: 0 } });

      expect(seenTokens).toEqual([
        `Bearer ${token}`,
        `Bearer ${token}`,
        `Bearer ${secondToken}`,
        `Bearer ${secondToken}`,
      ]);
    } finally {
      rmSync(secondWorktree, { recursive: true, force: true });
    }
  });

  it("rejects a forged project locator when returned metadata does not match the credential grant", async () => {
    const request = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/auth/preflight")) return Response.json({ data: {
        scopes: ["projects:read"], organizationId: "org-id", projectId: "project-id", projectIds: ["project-id"],
        audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: worktree,
        restartRequiredOnCredentialChange: true,
      } });
      return Response.json({ data: { project: { id: "different-project-id" } } });
    });

    await expect(ensureExtensionProject(worktree, apiBase, undefined, {
      request: request as unknown as typeof fetch,
      readiness: { retryDelayMs: 0 },
    })).rejects.toMatchObject({ failure: "not_found" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not create a missing project because credential grants require an existing project", async () => {
    const request = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/auth/preflight")) return Response.json({ data: {
        scopes: ["projects:read", "projects:create"], organizationId: "org-id", projectId: "project-id", projectIds: ["project-id"],
        audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: worktree,
        restartRequiredOnCredentialChange: true,
      } });
      return new Response(null, { status: 404 });
    });

    await expect(ensureExtensionProject(worktree, apiBase, undefined, {
      request: request as unknown as typeof fetch,
      readiness: { retryDelayMs: 0 },
    })).rejects.toMatchObject({ failure: "not_found" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
