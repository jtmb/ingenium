import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getMcpTransportUrl, preflightMcpLauncher } from "./scripts/mcp-server.js";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(extensionRoot, "../..");
let worktree = "";
const temporaryDirectories: string[] = [];
let originalProject: string | undefined;
let originalToken: string | undefined;
let originalTokenFile: string | undefined;

function writeProtectedToken(value = "a".repeat(32)): void {
  const tokenPath = join(worktree, ".opencode", ".ingenium-api-token");
  writeFileSync(tokenPath, `${value}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

beforeEach(() => {
  originalProject = process.env.INGENIUM_PROJECT;
  originalToken = process.env.INGENIUM_API_TOKEN;
  originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  delete process.env.INGENIUM_PROJECT;
  delete process.env.INGENIUM_API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  worktree = mkdtempSync(join(tmpdir(), "ingenium-mcp-launcher-"));
  mkdirSync(join(worktree, ".opencode"));
});

afterEach(() => {
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
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
      message: "Ingenium MCP could not read a protected API token. Run scripts/bootstrap-local-secrets.sh for local development or configure INGENIUM_API_TOKEN_FILE.",
    });
  });

  it("uses the validated worktree identity when no local project override is set", () => {
    writeProtectedToken();

    expect(preflightMcpLauncher(worktree)).toEqual({
      ok: true,
      project: basename(worktree),
    });
  });

  it("rejects the container workspace without exposing an unsafe identity", () => {
    const parent = mkdtempSync(join(tmpdir(), "ingenium-mcp-workspace-parent-"));
    temporaryDirectories.push(parent);
    const containerWorktree = join(parent, "workspace");
    mkdirSync(join(containerWorktree, ".opencode"), { recursive: true });
    writeFileSync(join(containerWorktree, ".opencode", ".ingenium-api-token"), `${"a".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(join(containerWorktree, ".opencode", ".ingenium-api-token"), 0o600);

    expect(preflightMcpLauncher(containerWorktree)).toEqual({
      ok: false,
      message: "Ingenium MCP could not resolve a safe project identity. Set INGENIUM_PROJECT to a valid project name.",
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
      "packages/ingenium-extension/dist/scripts/mcp-server.js",
    ]);
    expect(localConfig.mcp.ingenium.command.join(" ")).not.toContain("services/ingenium-server/dist");
    expect(localConfig.mcp.ingenium.environment.INGENIUM_API_TOKEN).toBe("{file:.opencode/.ingenium-api-token}");
    expect(localConfig.mcp.ingenium.environment.INGENIUM_PROJECT).toBeUndefined();
    expect(entrypoint).toContain('"command": ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"]');
    expect(entrypoint).toContain('"INGENIUM_PROJECT": "global-default"');
    expect(dockerfile).toContain('"command":["node","/app/packages/ingenium-extension/dist/scripts/mcp-server.js"]');
  });

  it("loads the packaged transport artifact rather than the server workspace path", () => {
    expect(getMcpTransportUrl("file:///tmp/extension/dist/scripts/mcp-server.js").href).toBe(
      "file:///tmp/extension/dist/scripts/mcp-transport.js",
    );
  });
});
