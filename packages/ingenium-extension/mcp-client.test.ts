import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preflightApiAuthentication, waitForAuthenticatedApiReadiness } from "./api-auth.js";
import {
  McpBridgeError,
  ObservableMcpTransport,
  MCP_LIVE_RELOAD_MAX_TIMEOUT_MS,
  callMcpTool,
  openMcpToolClient,
  packagedLauncherPath,
  resolveNodeExecutable,
  reconnectIngeniumMcp,
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
  function authenticatedResponse(): Response {
    return Response.json({ data: {
      scopes: [], organizationId: "organization", projectId: "project", projectIds: ["project"],
      audience: "mcp", workspaceId: "mcp-client-workspace", launcherWorktree: worktree,
      storageMappingHash: "a".repeat(64), restartRequiredOnCredentialChange: true,
    } });
  }

  it("retries a transient preflight 429 before authenticating", async () => {
    prepareWorktree();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockImplementation(async () => authenticatedResponse());
    const sleep = vi.fn(async (_delay: number) => undefined);
    await expect(preflightApiAuthentication("https://api.test/api/v1", worktree, request, { sleep }))
      .resolves.toMatchObject({ authenticated: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(500);
    expect(sleep.mock.calls[0]?.[0]).toBeLessThan(600);
  });

  it("bounds persistent preflight 429s to four requests, retaining the transient reason", async () => {
    prepareWorktree();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 429 }));
    const delays: number[] = [];
    await expect(waitForAuthenticatedApiReadiness("https://api.test/api/v1", worktree, {
      request, sleep: async (delay) => { delays.push(delay); },
    })).resolves.toMatchObject({ authenticated: false, failure: "unavailable", reason: "rate_limited" });
    expect(request).toHaveBeenCalledTimes(4);
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThan(600);
    expect(delays[1]).toBeGreaterThanOrEqual(1_000);
    expect(delays[1]).toBeLessThan(1_100);
    expect(delays[2]).toBe(2_000);
  });

  it.each([[401, "authentication"], [403, "scope"]] as const)("does not retry preflight %s", async (status, failure) => {
    prepareWorktree();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    const sleep = vi.fn(async () => undefined);
    await expect(waitForAuthenticatedApiReadiness("https://api.test/api/v1", worktree, { request, sleep }))
      .resolves.toMatchObject({ authenticated: false, failure });
    expect(request).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([["1", 1_000], ["60", 2_000], ["0", 0], ["Wed, 09 Sep 2099 00:00:00 GMT", 2_000]])(
    "honors Retry-After %s within the startup cap", async (retryAfter, expectedDelay) => {
      prepareWorktree();
      const request = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": retryAfter } }))
        .mockImplementation(async () => authenticatedResponse());
      const sleep = vi.fn(async (_delay: number) => undefined);
      await expect(preflightApiAuthentication("https://api.test/api/v1", worktree, request, { sleep }))
        .resolves.toMatchObject({ authenticated: true });
      expect(sleep.mock.calls).toEqual([[expectedDelay]]);
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it("attributes current server startup markers rather than the later close", async () => {
    prepareWorktree();
    const stderr = new PassThrough();
    await expect(withMcpClient(worktree, async () => undefined, {
      launcherPath: "/package/launcher.js", createTransport: () => ({ stderr, close: async () => undefined }),
      createClient: () => ({
        connect: async () => {
          stderr.write("Startup progress. ".repeat(100));
          stderr.write('{"boundary":"parent-mcp-startup","stage":"authentication","reason":"startup_failed"}\n');
          throw new Error("closed");
        }, callTool: async () => ({}), close: async () => undefined,
      }),
    })).rejects.toMatchObject({ failure: "authentication", stage: "authentication", boundary: "parent-mcp-startup" });
  });

  it("initializes and lists tools over real stdio, attributing a later tools/list exit", async () => {
    prepareWorktree();
    const launcher = join(worktree, "protocol.cjs");
    writeFileSync(launcher, `
      let listed = false;
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
          result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
        }) + '\\n');
        if (request.method === 'tools/list') {
          if (listed) process.exit(9);
          listed = true;
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [] } }) + '\\n');
        }
      });
    `);
    await expect(withMcpClient(worktree, async client => {
      await expect((client as Client).listTools()).resolves.toEqual({ tools: [] });
      return (client as Client).listTools();
    }, { launcherPath: launcher }))
      .rejects.toMatchObject({ stage: "tools-list", childExit: { code: 9, signal: null } });
  });

  it("redacts credentials split across stderr chunks and bounds multibyte output", async () => {
    prepareWorktree();
    const stderr = new PassThrough();
    const error = await withMcpClient(worktree, async () => undefined, {
      launcherPath: "/package/launcher.js", createTransport: () => ({ stderr, close: async () => undefined }),
      createClient: () => ({
        connect: async () => {
          stderr.write("Bearer sentinel_");
          stderr.write("credential_content_123456\n");
          stderr.write("界".repeat(2_000));
          throw new Error("closed");
        }, callTool: async () => ({}), close: async () => undefined,
      }),
    }).catch(error => error);
    expect(error.diagnostic).toContain("Bearer [redacted]");
    expect(error.diagnostic).not.toContain("credential_content");
    expect(Buffer.byteLength(error.diagnostic)).toBeLessThanOrEqual(1_024);
  });

  it.each(["local-binding", "project-preflight", "authentication", "import", "transport"] as const)(
    "retains the first launcher %s stage across both bridge lifecycles", async (stage) => {
      prepareWorktree();
      for (const persistent of [false, true]) {
        const stderr = new PassThrough();
        const transport = { stderr, lastExit: { code: 2, signal: null }, close: async () => undefined };
        const dependencies = {
          launcherPath: "/package/launcher.js",
          createTransport: () => transport,
          createClient: () => ({
            connect: async () => {
              stderr.write(JSON.stringify({ boundary: "launcher", stage, reason: stage }));
              stderr.write(JSON.stringify({ boundary: "launcher", stage: "transport", reason: "transport" }));
              throw new Error("connection closed");
            },
            callTool: async () => ({}), close: async () => undefined,
          }),
        };
        const result = persistent ? openMcpToolClient(worktree, dependencies)
          : withMcpClient(worktree, async () => undefined, dependencies);
        await expect(result).rejects.toMatchObject({ stage, boundary: "launcher", childExit: { code: 2, signal: null } });
      }
    },
  );

  it.each([7, "SIGTERM"] as const)("attributes real child close %s before cleanup", async (exit) => {
    prepareWorktree();
    const launcher = join(worktree, "exit.cjs");
    writeFileSync(launcher, typeof exit === "number" ? `process.exit(${exit})` : `process.kill(process.pid, '${exit}')`);
    await expect(withMcpClient(worktree, async () => undefined, { launcherPath: launcher })).rejects.toMatchObject({
      stage: "initialize", boundary: "bridge",
      childExit: { code: typeof exit === "number" ? exit : null, signal: typeof exit === "string" ? exit : null },
    });
  });

  it("reports an actual spawn error without claiming initialization", async () => {
    const transport = new ObservableMcpTransport({ command: "/nonexistent/ingenium-node", args: [], cwd: tmpdir(), env: {}, stderr: "pipe", shell: false });
    await expect(transport.start()).rejects.toMatchObject({ stage: "spawn" });
    await vi.waitFor(() => expect(transport.lastExit?.code).toBeTypeOf("number"));
    await transport.close();
  });

  it.each(["spawn", "initialize", "tools-list"] as const)("attributes timeout at %s without cleanup exit contamination", async (stage) => {
    prepareWorktree();
    const transport = { stage, lastExit: undefined as { code: number | null; signal: NodeJS.Signals | null } | undefined,
      close: async () => { transport.lastExit = { code: null, signal: "SIGTERM" }; } };
    await expect(openMcpToolClient(worktree, {
      timeoutMs: 1, launcherPath: "/package/launcher.js", createTransport: () => transport,
      createClient: () => ({ connect: () => new Promise<void>(() => {}), callTool: async () => ({}), close: async () => undefined }),
    })).rejects.toMatchObject({ failure: "timeout", stage: stage === "spawn" ? "spawntimeout" : stage, childExit: undefined });
  });

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

  it("allows repository synchronization to outlive the generic API timeout", async () => {
    prepareWorktree();
    process.env.INGENIUM_API_TIMEOUT = "1";
    const credentialPath = join(worktree, ".opencode", ".ingenium-repository-sync-credential");
    writeFileSync(credentialPath, `${"r".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(credentialPath, 0o600);
    let launch: McpBridgeLaunchOptions | undefined;

    await expect(callMcpTool(worktree, "repository_sync", { project: "mcp-client-project" }, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: (options) => {
        launch = options;
        return { stderr: new PassThrough(), close: async () => undefined };
      },
      createClient: () => ({
        connect: async () => undefined,
        callTool: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { content: [{ type: "text", text: "{}" }] };
        },
        close: async () => undefined,
      }),
    })).resolves.toBeDefined();
    expect(launch!.env.INGENIUM_API_TIMEOUT).toBe("60000");
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

  it("maps a repository generation conflict to the bounded retry revision", async () => {
    prepareWorktree();
    const credentialPath = join(worktree, ".opencode", ".ingenium-repository-sync-credential");
    writeFileSync(credentialPath, `${"r".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(credentialPath, 0o600);
    const error = await callMcpTool(worktree, "repository_sync", { project: "mcp-client-project" }, {
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: () => ({ stderr: new PassThrough(), close: async () => undefined }),
      createClient: () => ({
        connect: async () => undefined,
        callTool: async () => ({
          isError: true,
          content: [{ type: "text", text: JSON.stringify({
            error: { code: "MANIFEST_GENERATION_CONFLICT", message: SENTINEL_CREDENTIAL, currentGeneration: 9 },
          }) }],
        }),
        close: async () => undefined,
      }),
    }).catch((failure) => failure);

    expect(error).toMatchObject({
      failure: "revision_conflict",
      stage: "call",
      currentRevision: 9,
      errorCode: "MANIFEST_GENERATION_CONFLICT",
    });
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

  it("disconnects, reconnects, and checks only the injected Ingenium MCP server", async () => {
    const disconnect = vi.fn().mockResolvedValue({});
    const connect = vi.fn().mockResolvedValue({});
    const status = vi.fn().mockResolvedValue({ data: { ingenium: { status: "connected" }, retained: { status: "connected" } } });

    await expect(reconnectIngeniumMcp({ mcp: { disconnect, connect, status } }, "/workspace/project", 5_000))
      .resolves.toEqual({ status: "connected" });
    expect(disconnect).toHaveBeenCalledWith({ path: { name: "ingenium" }, query: { directory: "/workspace/project" } });
    expect(connect).toHaveBeenCalledWith({ path: { name: "ingenium" }, query: { directory: "/workspace/project" } });
    expect(status).toHaveBeenCalledWith({ query: { directory: "/workspace/project" } });
    expect(JSON.stringify([disconnect.mock.calls, connect.mock.calls])).not.toContain("retained");
  });

  it.each([4_999, 5_000.5, MCP_LIVE_RELOAD_MAX_TIMEOUT_MS + 1])("rejects invalid live reload timeout %s", async (timeoutMs) => {
    await expect(reconnectIngeniumMcp({ mcp: {} }, "/workspace/project", timeoutMs))
      .rejects.toBeInstanceOf(McpBridgeError);
  });

  it("accepts the maximum timeout and rejects a relative reload directory", async () => {
    const mcp = {
      disconnect: vi.fn().mockResolvedValue({}),
      connect: vi.fn().mockResolvedValue({}),
      status: vi.fn().mockResolvedValue({ data: { ingenium: { status: "connected" } } }),
    };
    await expect(reconnectIngeniumMcp({ mcp }, "/workspace/project", MCP_LIVE_RELOAD_MAX_TIMEOUT_MS)).resolves.toBeDefined();
    await expect(reconnectIngeniumMcp({ mcp }, "relative/project", 5_000)).rejects.toBeInstanceOf(McpBridgeError);
  });

  it("returns a sanitized failure when reconnect status omits Ingenium", async () => {
    const error = await reconnectIngeniumMcp({
      mcp: {
        disconnect: vi.fn().mockResolvedValue({}),
        connect: vi.fn().mockResolvedValue({}),
        status: vi.fn().mockResolvedValue({ data: { attacker: { detail: SENTINEL_CREDENTIAL } } }),
      },
    }, "/workspace/project", 5_000).catch((failure) => failure);

    expect(error).toBeInstanceOf(McpBridgeError);
    expect(JSON.stringify(error)).not.toContain(SENTINEL_CREDENTIAL);
  });

  it("rejects a non-connected Ingenium status", async () => {
    await expect(reconnectIngeniumMcp({
      mcp: {
        disconnect: vi.fn().mockResolvedValue({}),
        connect: vi.fn().mockResolvedValue({}),
        status: vi.fn().mockResolvedValue({ data: { ingenium: { status: "failed", detail: SENTINEL_CREDENTIAL } } }),
      },
    }, "/workspace/project", 5_000)).rejects.toBeInstanceOf(McpBridgeError);
  });
});
