import { afterEach, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  McpBridgeError,
  sanitizeMcpStderr,
  withMcpClient,
  type McpBridgeLaunchOptions,
} from "./mcp-client.js";

let worktree = "";
const originalApiUrl = process.env.INGENIUM_API_URL;
const originalTimeout = process.env.INGENIUM_API_TIMEOUT;
const originalProject = process.env.INGENIUM_PROJECT;
const originalToken = process.env.INGENIUM_API_TOKEN;
const originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
const originalMcpToken = process.env.INGENIUM_MCP_CREDENTIAL;
const originalMcpTokenFile = process.env.INGENIUM_MCP_CREDENTIAL_FILE;
const originalWorkspace = process.env.INGENIUM_WORKSPACE_ID;

function prepareWorktree(): void {
  worktree = mkdtempSync(join(tmpdir(), "ingenium-mcp-client-"));
  mkdirSync(join(worktree, ".opencode"));
  const tokenPath = join(worktree, ".opencode", ".ingenium-mcp-credential");
  writeFileSync(tokenPath, `${"a".repeat(32)}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  process.env.INGENIUM_PROJECT = "mcp-client-project";
  process.env.INGENIUM_API_URL = "http://api.test/api/v1";
  delete process.env.INGENIUM_API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  delete process.env.INGENIUM_MCP_CREDENTIAL;
  delete process.env.INGENIUM_MCP_CREDENTIAL_FILE;
  process.env.INGENIUM_WORKSPACE_ID = "mcp-client-workspace";
}

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.INGENIUM_API_URL;
  else process.env.INGENIUM_API_URL = originalApiUrl;
  if (originalTimeout === undefined) delete process.env.INGENIUM_API_TIMEOUT;
  else process.env.INGENIUM_API_TIMEOUT = originalTimeout;
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
  if (originalMcpToken === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL;
  else process.env.INGENIUM_MCP_CREDENTIAL = originalMcpToken;
  if (originalMcpTokenFile === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL_FILE;
  else process.env.INGENIUM_MCP_CREDENTIAL_FILE = originalMcpTokenFile;
  if (originalWorkspace === undefined) delete process.env.INGENIUM_WORKSPACE_ID;
  else process.env.INGENIUM_WORKSPACE_ID = originalWorkspace;
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("extension MCP client bridge", () => {
  it("launches only the packaged launcher with a closed, validated environment", async () => {
    prepareWorktree();
    let launch: McpBridgeLaunchOptions | undefined;
    const stderr = new PassThrough();
    const transport = { stderr, close: async () => undefined };
    const client = {
      connect: async () => undefined,
      callTool: async () => ({ content: [] }),
      close: async () => undefined,
    };

    await expect(withMcpClient(worktree, async (_client, project) => project, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: (options) => {
        launch = options;
        return transport;
      },
      createClient: () => client,
    })).resolves.toBe("mcp-client-project");

    expect(launch).toEqual(expect.objectContaining({
      command: process.execPath,
      args: ["/package/dist/scripts/mcp-server.js"],
      cwd: worktree,
      shell: false,
      env: expect.objectContaining({
        INGENIUM_API_URL: "http://api.test/api/v1",
        INGENIUM_PROJECT: "mcp-client-project",
        INGENIUM_WORKTREE: worktree,
        INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
        INGENIUM_WORKSPACE_ID: "mcp-client-workspace",
      }),
    }));
    expect(Object.keys(launch!.env)).not.toContain("OPENCODE_CONFIG");
  });

  it("times out and closes a stalled bridge", async () => {
    prepareWorktree();
    process.env.INGENIUM_API_TIMEOUT = "1";
    let closed = false;
    const transport = { close: async () => { closed = true; } };
    const client = {
      connect: async () => new Promise<void>(() => undefined),
      callTool: async () => ({ content: [] }),
      close: async () => undefined,
    };

    await expect(withMcpClient(worktree, async () => "never", {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: () => transport,
      createClient: () => client,
    })).rejects.toMatchObject({ failure: "timeout" } satisfies Partial<McpBridgeError>);
    expect(closed).toBe(true);
  });

  it("fails when a close path cannot complete", async () => {
    prepareWorktree();
    const transport = { close: async () => { throw new Error("close failed"); } };
    const client = {
      connect: async () => undefined,
      callTool: async () => ({ content: [] }),
      close: async () => { throw new Error("close failed"); },
    };

    await expect(withMcpClient(worktree, async () => "done", {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: () => transport,
      createClient: () => client,
    })).rejects.toMatchObject({ failure: "request_failed" } satisfies Partial<McpBridgeError>);
  });

  it("bounds and redacts child stderr", () => {
    const diagnostic = sanitizeMcpStderr(`Bearer ${"s".repeat(32)} http://private.example/path /tmp/private/file\n${"x".repeat(2_000)}`);

    expect(diagnostic).toContain("Bearer [redacted]");
    expect(diagnostic).not.toContain("private.example");
    expect(diagnostic).not.toContain("/tmp/private/file");
    expect(Buffer.byteLength(diagnostic, "utf8")).toBeLessThanOrEqual(1_024);
  });
});
