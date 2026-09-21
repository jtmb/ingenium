import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  ExtensionProjectStartupError,
  ensureExtensionProject,
  resetEnsuredProjects,
  resolveExtensionProject,
} from "./project-resolver.js";

const token = "r".repeat(32);
const apiBase = "https://api.test/api/v1";
const storageMappingHash = "a".repeat(64);
let worktree = "";

function writeProtectedToken(directory: string, value = token): void {
  const opencode = join(directory, ".opencode");
  mkdirSync(opencode, { recursive: true });
  const tokenPath = join(opencode, ".ingenium-mcp-credential");
  writeFileSync(tokenPath, `${value}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

beforeEach(() => {
  vi.stubEnv("INGENIUM_PROJECT", "external-startup-project");
  vi.stubEnv("INGENIUM_WORKSPACE_ID", "workspace-fixture");
  vi.stubEnv("INGENIUM_TRUSTED_API_URL", apiBase);
  worktree = mkdtempSync(join(tmpdir(), "ingenium-project-readiness-"));
  writeProtectedToken(worktree);
  resetEnsuredProjects();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnsuredProjects();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("extension project startup readiness", () => {
  it("uses the safe worktree basename as a locator and attests its credential grant", async () => {
    delete process.env.INGENIUM_PROJECT;
    const project = basename(worktree);
    const request = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/auth/preflight")) return Response.json({ data: {
        scopes: ["projects:read"], organizationId: "org-id", projectId: "project-id", projectIds: ["project-id"],
        audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: worktree, storageMappingHash,
        restartRequiredOnCredentialChange: true,
      } });
      expect(path).toBe(`/api/v1/projects/${project}/detail`);
      return Response.json({ data: { project: { id: "project-id" } } });
    });

    await expect(ensureExtensionProject(worktree, apiBase, undefined, {
      request: request as unknown as typeof fetch,
      readiness: { retryDelayMs: 0 },
    })).resolves.toBe(project);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps requested-project and environment precedence over basename fallback", () => {
    process.env.INGENIUM_PROJECT = "environment-project";

    expect(resolveExtensionProject("/workspace", "requested-project")).toBe("requested-project");
    expect(resolveExtensionProject(worktree)).toBe("environment-project");
  });

  it("allows workspace as a safe basename outside the canonical container worktree", () => {
    delete process.env.INGENIUM_PROJECT;

    expect(resolveExtensionProject("/tmp/safe/workspace")).toBe("workspace");
  });

  it("fails closed on unsafe explicit locators instead of using the basename", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(() => resolveExtensionProject(worktree, "../requested-project"))
      .toThrow("--project is not a safe project name");
    process.env.INGENIUM_PROJECT = "../environment-project";
    expect(() => resolveExtensionProject(worktree))
      .toThrow("INGENIUM_PROJECT is not a safe project name");

    const output = stderr.mock.calls.flat().join("");
    expect(output).not.toContain("../requested-project");
    expect(output).not.toContain("../environment-project");
    expect(output).not.toContain(worktree);
  });

  it("fails closed with sanitized diagnostics for unsafe worktree basenames", () => {
    delete process.env.INGENIUM_PROJECT;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    for (const unsafeWorktree of ["/workspace", "/tmp/../workspace", "/", "", "/safe/..", "/safe/bad\u0000name"]) {
      expect(() => resolveExtensionProject(unsafeWorktree))
        .toThrow("Worktree does not resolve to a safe project name");
    }

    const output = stderr.mock.calls.flat().join("");
    expect(output).not.toContain("/workspace");
    expect(output).not.toContain("/safe/");
    expect(output).not.toContain("\u0000");
  });

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
          audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: worktree, storageMappingHash, restartRequiredOnCredentialChange: true,
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
          storageMappingHash,
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
        audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: worktree, storageMappingHash,
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
        audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: worktree, storageMappingHash,
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

  it.each([
    ["missing", undefined],
    ["malformed", "A".repeat(64)],
  ])("fails closed when the preflight storage mapping hash is %s", async (_label, invalidHash) => {
    const request = vi.fn(async () => Response.json({ data: {
      scopes: ["projects:read"], organizationId: "org-id", projectId: "project-id", projectIds: ["project-id"],
      audience: "mcp", workspaceId: "workspace-fixture", launcherWorktree: worktree,
      ...(invalidHash === undefined ? {} : { storageMappingHash: invalidHash }),
      restartRequiredOnCredentialChange: true,
    } }));

    await expect(ensureExtensionProject(worktree, apiBase, undefined, {
      request: request as unknown as typeof fetch,
      readiness: { retryDelayMs: 0 },
    })).rejects.toMatchObject({ failure: "authentication" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
