import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  McpBridgeError,
  callMcpTool,
  openMcpToolClient,
  packagedLauncherPath,
  resolveNodeExecutable,
  sanitizeMcpStderr,
  withMcpClient,
  type McpBridgeLaunchOptions,
} from "./mcp-client.js";

let worktree = "";
const SENTINEL_CREDENTIAL = "sentinel_credential_content_123456";

function prepareWorktree(token = "a".repeat(32)): void {
  worktree = mkdtempSync(join(tmpdir(), "ingenium-mcp-client-"));
  mkdirSync(join(worktree, ".opencode"));
  const tokenPath = join(worktree, ".opencode", ".ingenium-mcp-credential");
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  vi.stubEnv("INGENIUM_PROJECT", "mcp-client-project");
  vi.stubEnv("INGENIUM_API_URL", "https://api.test/api/v1");
  vi.stubEnv("INGENIUM_TRUSTED_API_URL", "https://api.test/api/v1");
  vi.stubEnv("INGENIUM_API_TOKEN", undefined);
  vi.stubEnv("INGENIUM_API_TOKEN_FILE", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL_FILE", undefined);
  vi.stubEnv("INGENIUM_WORKSPACE_ID", "mcp-client-workspace");
  vi.stubEnv("INGENIUM_API_TIMEOUT", process.env.INGENIUM_API_TIMEOUT);
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("extension MCP client bridge", () => {
  it("uses Node rather than the OpenCode executable for short-lived MCP children", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-node-executable-"));
    const executable = join(directory, "node");
    try {
      writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
      chmodSync(executable, 0o755);

      expect(resolveNodeExecutable("/opt/opencode", directory)).toBe(realpathSync(executable));
      chmodSync(executable, 0o777);
      expect(() => resolveNodeExecutable("/opt/opencode", directory)).toThrow(McpBridgeError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the compiled launcher when OpenCode loads a source plugin entry", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-source-plugin-"));
    const sourceModule = join(directory, "mcp-client.ts");
    const launcher = join(directory, "dist", "scripts", "mcp-server.js");
    try {
      mkdirSync(join(directory, "dist", "scripts"), { recursive: true });
      writeFileSync(sourceModule, "");
      writeFileSync(launcher, "");

      expect(packagedLauncherPath(new URL(`file://${sourceModule}`).href)).toBe(launcher);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("launches only the packaged launcher with a closed, validated environment", async () => {
    prepareWorktree(SENTINEL_CREDENTIAL);
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
        INGENIUM_API_URL: "https://api.test/api/v1",
        INGENIUM_API_URL_TRUSTED: "1",
        INGENIUM_TRUSTED_API_URL: "https://api.test/api/v1",
        INGENIUM_PROJECT: "mcp-client-project",
        INGENIUM_WORKTREE: worktree,
        INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
        INGENIUM_MCP_CREDENTIAL_PURPOSE: "general",
        INGENIUM_MCP_AUDIENCE: "mcp",
        INGENIUM_WORKSPACE_ID: "mcp-client-workspace",
      }),
    }));
    expect(launch!.env.INGENIUM_MCP_CREDENTIAL).toBeUndefined();
    expect(Object.keys(launch!.env)).not.toContain("OPENCODE_CONFIG");
    expect(JSON.stringify(launch)).not.toContain(SENTINEL_CREDENTIAL);
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

  it.each([
    ["extraction_run", "learning", ".ingenium-learning-credential", "mcp"],
    ["synthesis_run", "learning", ".ingenium-learning-credential", "mcp"],
    ["pipeline_event_log", "learning", ".ingenium-learning-credential", "mcp"],
    ["observe", "learning", ".ingenium-learning-credential", "mcp"],
    ["repository_sync", "repository-sync", ".ingenium-repository-sync-credential", "repository-sync"],
    ["project_detail", "general", ".ingenium-mcp-credential", "mcp"],
  ] as const)("selects the operation-specific credential for %s", async (name, purpose, fileName, audience) => {
    prepareWorktree();
    if (purpose !== "general") {
      const path = join(worktree, ".opencode", fileName);
      writeFileSync(path, `${purpose[0]!.repeat(32)}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    let launch: McpBridgeLaunchOptions | undefined;
    const transport = { stderr: new PassThrough(), close: async () => undefined };
    const client = {
      connect: async () => undefined,
      callTool: async () => ({ content: [{ type: "text", text: "{}" }] }),
      close: async () => undefined,
    };

    await callMcpTool(worktree, name, { project: "mcp-client-project" }, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: (options) => { launch = options; return transport; },
      createClient: () => client,
    });

    expect(launch!.env).toMatchObject({
      INGENIUM_MCP_CREDENTIAL_PURPOSE: purpose,
      INGENIUM_MCP_AUDIENCE: audience,
      INGENIUM_MCP_CREDENTIAL_FILE: `.opencode/${fileName}`,
    });
    expect(launch!.env.INGENIUM_MCP_CREDENTIAL).toBeUndefined();
  });

  it("preserves a fixed rate-limit failure without exposing the tool payload", async () => {
    prepareWorktree();
    const client = {
      connect: async () => undefined,
      callTool: async () => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: { code: "RATE_LIMITED", message: SENTINEL_CREDENTIAL } }) }],
      }),
      close: async () => undefined,
    };

    const error = await callMcpTool(worktree, "coordination_status", { project: "mcp-client-project" }, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: () => ({ stderr: new PassThrough(), close: async () => undefined }),
      createClient: () => client,
    }).catch((failure) => failure);

    expect(error).toBeInstanceOf(McpBridgeError);
    expect((error as McpBridgeError).failure).toBe("rate_limited");
    expect((error as McpBridgeError).stage).toBe("call");
    expect((error as McpBridgeError).errorCode).toBe("RATE_LIMITED");
    expect(JSON.stringify(error)).not.toContain(SENTINEL_CREDENTIAL);
  });

  it("retains only the safe current revision from a revision conflict", async () => {
    prepareWorktree();
    const client = {
      connect: async () => undefined,
      callTool: async () => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify({
          error: { code: "REVISION_CONFLICT", message: SENTINEL_CREDENTIAL, currentRevision: 7 },
        }) }],
      }),
      close: async () => undefined,
    };

    const error = await callMcpTool(worktree, "coordination_handoff", { project: "mcp-client-project" }, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: () => ({ stderr: new PassThrough(), close: async () => undefined }),
      createClient: () => client,
    }).catch((failure) => failure);

    expect(error).toMatchObject({ failure: "revision_conflict", stage: "call", currentRevision: 7, errorCode: "REVISION_CONFLICT" });
    expect(JSON.stringify(error)).not.toContain(SENTINEL_CREDENTIAL);
  });

  it("retains only a normalized coordination error code", async () => {
    prepareWorktree();
    const error = await callMcpTool(worktree, "coordination_claim", { project: "mcp-client-project" }, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: () => ({ stderr: new PassThrough(), close: async () => undefined }),
      createClient: () => ({
        connect: async () => undefined,
        callTool: async () => ({
          isError: true,
          content: [{ type: "text", text: JSON.stringify({
            error: { code: "EPOCH_QUARANTINED", message: SENTINEL_CREDENTIAL },
          }) }],
        }),
        close: async () => undefined,
      }),
    }).catch((failure) => failure);

    expect(error).toMatchObject({ failure: "request_failed", stage: "call", errorCode: "EPOCH_QUARANTINED" });
    expect(JSON.stringify(error)).not.toContain(SENTINEL_CREDENTIAL);
  });

  it("classifies a fixed rate limit during MCP startup", async () => {
    prepareWorktree();
    const stderr = new PassThrough();
    const error = await withMcpClient(worktree, async () => undefined, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: () => ({ stderr, close: async () => undefined }),
      createClient: () => ({
        connect: async () => {
          stderr.write('{"boundary":"parent-mcp-transport","reason":"rate_limited"}\n');
          await new Promise((resolve) => setImmediate(resolve));
          throw new Error("private startup error");
        },
        callTool: async () => ({}),
        close: async () => undefined,
      }),
    }).catch((failure) => failure);

    expect(error).toBeInstanceOf(McpBridgeError);
    expect((error as McpBridgeError).failure).toBe("rate_limited");
    expect((error as McpBridgeError).stage).toBe("connect");
    expect(JSON.stringify(error)).not.toContain("private startup error");
  });

  it("reuses one connected bridge for multiple tool calls", async () => {
    prepareWorktree();
    const connect = vi.fn().mockResolvedValue(undefined);
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    const close = vi.fn().mockResolvedValue(undefined);
    const bridge = await openMcpToolClient(worktree, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: () => ({ stderr: new PassThrough(), close }),
      createClient: () => ({ connect, callTool, close }),
    });

    await bridge.callTool("coordination_status", { project: "mcp-client-project" });
    await bridge.callTool("coordination_status", { project: "mcp-client-project" });
    await bridge.close();
    await bridge.close();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
