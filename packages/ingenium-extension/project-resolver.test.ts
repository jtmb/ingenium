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

function writeProtectedToken(directory: string, value = token): void {
  const opencode = join(directory, ".opencode");
  mkdirSync(opencode, { recursive: true });
  const tokenPath = join(opencode, ".ingenium-api-token");
  writeFileSync(tokenPath, `${value}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

beforeEach(() => {
  originalProject = process.env.INGENIUM_PROJECT;
  process.env.INGENIUM_PROJECT = "external-startup-project";
  worktree = mkdtempSync(join(tmpdir(), "ingenium-project-readiness-"));
  writeProtectedToken(worktree);
  resetEnsuredProjects();
});

afterEach(() => {
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  resetEnsuredProjects();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("extension project startup readiness", () => {
  it("performs a finite authenticated readiness retry before the first project provision", async () => {
    let preflightAttempts = 0;
    const sleep = vi.fn(async () => undefined);
    const request = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
      if (path.endsWith("/auth/preflight")) {
        preflightAttempts += 1;
        return new Response("not ready", { status: preflightAttempts < 3 ? 503 : 200 });
      }
      expect(path).toBe("/api/v1/projects");
      return new Response(null, { status: 201 });
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
      "/api/v1/projects",
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
        seenTokens.push(new Headers(init?.headers).get("Authorization") ?? "");
        const path = new URL(String(url)).pathname;
        return new Response(null, { status: path.endsWith("/auth/preflight") ? 200 : 409 });
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
});
