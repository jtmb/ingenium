import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getMcpTransportUrl, preflightMcpLauncher, runMcpLauncher } from "./scripts/mcp-server.js";
import { ExtensionProjectStartupError } from "./project-resolver.js";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(extensionRoot, "../..");
let worktree = "";
const temporaryDirectories: string[] = [];

function writeProtectedToken(value = "a".repeat(32), name = ".ingenium-mcp-credential"): void {
  const tokenPath = join(worktree, ".opencode", name);
  writeFileSync(tokenPath, `${value}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

beforeEach(() => {
  vi.stubEnv("INGENIUM_PROJECT", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL_FILE", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL_PURPOSE", undefined);
  vi.stubEnv("INGENIUM_MCP_AUDIENCE", undefined);
  vi.stubEnv("INGENIUM_RUNTIME_CREDENTIAL_FILE", undefined);
  vi.stubEnv("INGENIUM_API_URL", undefined);
  vi.stubEnv("INGENIUM_API_URL_TRUSTED", undefined);
  vi.stubEnv("INGENIUM_WORKTREE", undefined);
  vi.stubEnv("INGENIUM_WORKSPACE_ID", "launcher-workspace");
  worktree = mkdtempSync(join(tmpdir(), "ingenium-mcp-launcher-"));
  mkdirSync(join(worktree, ".opencode"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  worktree = "";
});

describe("packaged Ingenium MCP launcher", () => {
  it("survives preflight 429 then 200 without exiting at transport stage", async () => {
    writeProtectedToken();
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ data: {
        scopes: [], organizationId: "organization", projectId: "project", projectIds: ["project"],
        audience: "mcp", workspaceId: "launcher-workspace", launcherWorktree: worktree,
        storageMappingHash: "a".repeat(64), restartRequiredOnCredentialChange: true,
      } }))
      .mockResolvedValueOnce(Response.json({ data: { project: { id: "project" } } }));
    vi.stubGlobal("fetch", request);
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const importTransport = vi.fn(async () => undefined);
    const launch = runMcpLauncher(worktree, { importTransport });
    await vi.runAllTimersAsync();
    await expect(launch).resolves.toBe(0);
    expect(request).toHaveBeenCalledTimes(3);
    expect(importTransport).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it("fails closed with an actionable message when the protected token is unavailable", () => {
    process.env.INGENIUM_PROJECT = "launcher-project";

    expect(preflightMcpLauncher(worktree)).toEqual({
      ok: false,
      stage: "authentication",
      message: "Ingenium MCP could not read a protected scoped credential. Configure INGENIUM_MCP_CREDENTIAL_FILE.",
    });
  });

  it("uses the validated worktree basename when no explicit project locator is set", () => {
    writeProtectedToken();

    expect(preflightMcpLauncher(worktree)).toEqual({
      ok: true,
      project: basename(worktree),
    });
  });

  it("rejects the canonical container workspace without exposing an unsafe identity", () => {
    expect(preflightMcpLauncher("/workspace")).toEqual({
      ok: false,
      stage: "project-preflight",
      message: "Ingenium MCP could not resolve a safe project identity. Set INGENIUM_PROJECT to a valid project name.",
    });
  });

  it("allows workspace as a safe basename outside the canonical container worktree", () => {
    const parent = mkdtempSync(join(tmpdir(), "ingenium-mcp-workspace-parent-"));
    temporaryDirectories.push(parent);
    const containerWorktree = join(parent, "workspace");
    mkdirSync(join(containerWorktree, ".opencode"), { recursive: true });
    writeFileSync(join(containerWorktree, ".opencode", ".ingenium-mcp-credential"), `${"a".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(join(containerWorktree, ".opencode", ".ingenium-mcp-credential"), 0o600);

    expect(preflightMcpLauncher(containerWorktree)).toEqual({
      ok: true,
      project: "workspace",
    });
  });

  it("projects local and Docker configs onto the same packaged launcher without tracking a token", () => {
    const localConfig = JSON.parse(readFileSync(join(repositoryRoot, "opencode.json"), "utf8")) as {
      mcp: { ingenium: { command: string[]; environment: Record<string, string> } };
    };
    const entrypoint = readFileSync(join(repositoryRoot, "scripts", "docker-entrypoint.sh"), "utf8");
    const dockerfile = readFileSync(join(repositoryRoot, "Dockerfile"), "utf8");

    expect(localConfig.mcp.ingenium.command).toEqual([
      "/usr/bin/env",
      "node",
      "{env:PWD}/packages/ingenium-extension/dist/scripts/mcp-server.js",
    ]);
    expect(localConfig.mcp.ingenium.command.join(" ")).not.toContain("services/ingenium-server/dist");
    expect(localConfig.mcp.ingenium.environment.INGENIUM_MCP_CREDENTIAL).toBeUndefined();
    expect(localConfig.mcp.ingenium.environment.INGENIUM_MCP_CREDENTIAL_FILE).toBe(".opencode/.ingenium-mcp-credential");
    expect(localConfig.mcp.ingenium.environment.INGENIUM_PROJECT).toBe("ingenium");
    expect(entrypoint).toContain('"command": ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"]');
    expect(entrypoint).toContain('"INGENIUM_MCP_CREDENTIAL_FILE": "/run/ingenium-opencode/.ingenium-mcp-credential"');
    expect(entrypoint).not.toContain('"INGENIUM_MCP_CREDENTIAL": "{file:.opencode/.ingenium-mcp-credential}"');
    expect(entrypoint).toContain('"INGENIUM_PROJECT": "ingenium"');
    expect(entrypoint).not.toContain('"INGENIUM_API_TOKEN_FILE": ".opencode/.ingenium-api-token"');
    expect(dockerfile).toContain('"command":["node","/app/packages/ingenium-extension/dist/scripts/mcp-server.js"]');
  });

  it("keeps legacy credential content out of launcher diagnostics", async () => {
    const sentinel = "sentinel_credential_content_123456";
    process.env.INGENIUM_PROJECT = "launcher-project";
    process.env.INGENIUM_MCP_CREDENTIAL = sentinel;
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(runMcpLauncher(worktree)).resolves.toBe(2);

    const captured = write.mock.calls.map(([value]) => String(value)).join("");
    expect(JSON.parse(captured)).toEqual({ boundary: "launcher", stage: "local-binding", reason: "local-binding", message: "Ingenium MCP could not resolve its protected local binding." });
    expect(captured).not.toContain(sentinel);
  });

  it("distinguishes invalid local binding from a missing credential", () => {
    writeProtectedToken();
    process.env.INGENIUM_PROJECT = "launcher-project";
    process.env.INGENIUM_API_URL = "https://untrusted.example/api/v1";

    expect(preflightMcpLauncher(worktree)).toEqual({
      ok: false,
      stage: "local-binding",
      message: "Ingenium MCP could not resolve its protected local binding.",
    });
  });

  it("loads the packaged transport artifact rather than the server workspace path", () => {
    expect(getMcpTransportUrl("file:///tmp/extension/dist/scripts/mcp-server.js").href).toBe(
      "file:///tmp/extension/dist/scripts/mcp-transport.js",
    );
  });

  it("keeps normal launcher startup free of build, test, and scan subprocesses", () => {
    const source = readFileSync(join(extensionRoot, "scripts", "mcp-server.ts"), "utf8");

    expect(source).not.toContain("node:child_process");
    expect(source).not.toMatch(/\b(?:spawn|execFile|execFileSync|spawnSync)\s*\(/);
  });

  it("provisions the validated project before importing the packaged transport", async () => {
    writeProtectedToken();
    process.env.INGENIUM_PROJECT = "launcher-project";
    let projectDuringImport: string | undefined;
    let importedTransport: URL | undefined;
    const ensureProject = vi.fn(async (resolvedWorktree: string, apiBase: string, project: string) => {
      expect(resolvedWorktree).toBe(worktree);
      expect(apiBase).toBe("http://localhost:4097/api/v1");
      expect(project).toBe("launcher-project");
      return project;
    });

    await expect(runMcpLauncher(worktree, {
      ensureProject,
      importTransport: async (transportUrl) => {
        projectDuringImport = process.env.INGENIUM_PROJECT;
        importedTransport = transportUrl;
      },
    })).resolves.toBe(0);

    expect(projectDuringImport).toBe("launcher-project");
    expect(importedTransport).toEqual(getMcpTransportUrl());
    expect(ensureProject).toHaveBeenCalledOnce();
  });

  it("hands the validated credential to the transport independently of server cwd", async () => {
    writeProtectedToken();
    process.env.INGENIUM_PROJECT = "launcher-project";
    const serverCwd = mkdtempSync(join(tmpdir(), "ingenium-mcp-server-cwd-"));
    temporaryDirectories.push(serverCwd);
    const originalCwd = process.cwd();

    process.chdir(serverCwd);
    try {
      await expect(runMcpLauncher(worktree, {
        ensureProject: async (_resolvedWorktree, _apiBase, project) => project,
        importTransport: async () => {
          expect(process.cwd()).toBe(serverCwd);
          expect(process.env.INGENIUM_WORKTREE).toBe(worktree);
          expect(process.env.INGENIUM_MCP_CREDENTIAL_FILE).toBe(
            join(worktree, ".opencode", ".ingenium-mcp-credential"),
          );
        },
      })).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("accepts the repository-sync startup audience without misclassifying it as a transport failure", async () => {
    writeProtectedToken("r".repeat(32), ".ingenium-repository-sync-credential");
    process.env.INGENIUM_PROJECT = "launcher-project";
    process.env.INGENIUM_MCP_AUDIENCE = "repository-sync";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = ".opencode/.ingenium-repository-sync-credential";

    await expect(runMcpLauncher(worktree, {
      ensureProject: async (_resolvedWorktree, _apiBase, project) => project,
      importTransport: async () => {
        expect(process.env.INGENIUM_MCP_AUDIENCE).toBe("repository-sync");
        expect(process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE).toBe("repository-sync");
        expect(process.env.INGENIUM_MCP_CREDENTIAL_FILE).toBe(
          join(worktree, ".opencode", ".ingenium-repository-sync-credential"),
        );
      },
    })).resolves.toBe(0);
  });

  it.each([
    ["authentication", "authentication", "Ingenium MCP authentication failed during project preflight."],
    ["not_found", "project-preflight", "Ingenium MCP project preflight rejected the configured project binding."],
    ["unavailable", "transport", "Ingenium MCP API transport was unavailable during project preflight."],
  ] as const)("reports %s project setup failures before transport import", async (failure, stage, message) => {
    writeProtectedToken();
    process.env.INGENIUM_PROJECT = "launcher-project";
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const importTransport = vi.fn(async () => undefined);

    await expect(runMcpLauncher(worktree, {
      ensureProject: async () => { throw new ExtensionProjectStartupError(failure); },
      importTransport,
    })).resolves.toBe(2);

    expect(importTransport).not.toHaveBeenCalled();
    expect(JSON.parse(write.mock.calls.map(([value]) => String(value)).join("")))
      .toEqual({ boundary: "launcher", stage, reason: stage, message });
  });

  it("reports a packaged transport import failure without exposing its error", async () => {
    const sentinel = "sentinel_import_path_123456";
    writeProtectedToken();
    process.env.INGENIUM_PROJECT = "launcher-project";
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(runMcpLauncher(worktree, {
      ensureProject: async (_resolvedWorktree, _apiBase, project) => project,
      importTransport: async () => { throw new Error(sentinel); },
    })).resolves.toBe(1);

    const captured = write.mock.calls.map(([value]) => String(value)).join("");
    expect(JSON.parse(captured)).toEqual({ boundary: "launcher", stage: "import", reason: "import", message: "Ingenium MCP launcher is incomplete. Build @ingenium/extension before starting OpenCode." });
    expect(captured).not.toContain(sentinel);
  });
});
