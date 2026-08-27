import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getMcpTransportUrl, preflightMcpLauncher, runMcpLauncher } from "./scripts/mcp-server.js";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(extensionRoot, "../..");
let worktree = "";
const temporaryDirectories: string[] = [];

function writeProtectedToken(value = "a".repeat(32)): void {
  const tokenPath = join(worktree, ".opencode", ".ingenium-mcp-credential");
  writeFileSync(tokenPath, `${value}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

beforeEach(() => {
  vi.stubEnv("INGENIUM_PROJECT", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL_FILE", undefined);
  vi.stubEnv("INGENIUM_WORKSPACE_ID", "launcher-workspace");
  worktree = mkdtempSync(join(tmpdir(), "ingenium-mcp-launcher-"));
  mkdirSync(join(worktree, ".opencode"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  worktree = "";
});

describe("packaged Ingenium MCP launcher", () => {
  it("fails closed with an actionable message when the protected token is unavailable", () => {
    process.env.INGENIUM_PROJECT = "launcher-project";

    expect(preflightMcpLauncher(worktree)).toEqual({
      ok: false,
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
    expect(entrypoint).toContain('"INGENIUM_MCP_CREDENTIAL_FILE": ".opencode/.ingenium-mcp-credential"');
    expect(entrypoint).not.toContain('"INGENIUM_MCP_CREDENTIAL": "{file:.opencode/.ingenium-mcp-credential}"');
    expect(entrypoint).toContain('"INGENIUM_PROJECT": "global-default"');
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
    expect(captured).toBe("[ingenium-mcp] Ingenium MCP could not read a protected scoped credential. Configure INGENIUM_MCP_CREDENTIAL_FILE.\n");
    expect(captured).not.toContain(sentinel);
  });

  it("loads the packaged transport artifact rather than the server workspace path", () => {
    expect(getMcpTransportUrl("file:///tmp/extension/dist/scripts/mcp-server.js").href).toBe(
      "file:///tmp/extension/dist/scripts/mcp-transport.js",
    );
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
});
