import { afterEach, describe, expect, it, vi } from "vitest";
import { ChildMcpRuntimeManager, ChildMcpRuntimeError } from "../lib/proxy.js";

const fixture = new URL("./fixtures/child-mcp-server.mjs", import.meta.url).pathname;
const originalParentSecret = process.env.PARENT_MCP_SECRET;

const managers: ChildMcpRuntimeManager[] = [];

function createManager(): ChildMcpRuntimeManager {
  const manager = new ChildMcpRuntimeManager({ startupMs: 750, requestMs: 250, shutdownMs: 750 });
  managers.push(manager);
  return manager;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error("Timed out waiting for child MCP state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stopAll()));
  if (originalParentSecret === undefined) delete process.env.PARENT_MCP_SECRET;
  else process.env.PARENT_MCP_SECRET = originalParentSecret;
});

describe("child MCP runtime", () => {
  it("initializes a real client, discovers tools, forwards only discovered calls, and inherits a minimal environment", async () => {
    process.env.PARENT_MCP_SECRET = "must-not-reach-child";
    const manager = createManager();
    manager.registerServer({
      name: "fixture",
      executable: process.execPath,
      args: [fixture],
      environment: { CHILD_MCP_CONFIGURED_VALUE: "configured" },
    });

    const started = await manager.startServer("fixture");
    expect(started).toMatchObject({ state: "ready", toolCount: 4 });
    expect(started.pid).toEqual(expect.any(Number));

    const tools = await manager.listTools("fixture");
    expect(tools.map((tool) => tool.name)).toEqual(["echo", "environment", "hang", "spawn_descendant"]);

    const echo = await manager.callTool("fixture", "echo", { value: "forwarded" });
    expect(echo).toMatchObject({ content: [{ type: "text", text: "forwarded" }] });

    const environment = await manager.callTool("fixture", "environment");
    expect(environment).toMatchObject({
      content: [{ type: "text", text: JSON.stringify({ hasParentSecret: false, configuredValue: "configured", hasPath: true }) }],
    });

    await expect(manager.callTool("fixture", "not_discovered", {})).rejects.toMatchObject({
      code: "CHILD_MCP_UNKNOWN_TOOL",
    });
    await expect(manager.callTool("fixture", "ingenium_echo", {})).rejects.toMatchObject({
      code: "CHILD_MCP_UNKNOWN_TOOL",
    });
  });

  it("reports child exit status, supports an explicit bounded reconnect, and terminates the child on stop", async () => {
    const manager = createManager();
    manager.registerServer({ name: "fixture", executable: process.execPath, args: [fixture] });
    const started = await manager.startServer("fixture");
    const firstPid = started.pid!;

    process.kill(firstPid, "SIGTERM");
    await waitFor(() => manager.getStatus("fixture").state === "exited");
    expect(manager.getStatus("fixture")).toMatchObject({
      state: "exited",
      lastExit: { signal: "SIGTERM" },
      diagnostic: "unavailable",
    });

    const recovered = await manager.reconnectServer("fixture");
    expect(recovered).toMatchObject({ state: "ready", diagnostic: null });
    const recoveredPid = recovered.pid!;
    await manager.stopServer("fixture");
    expect(manager.getStatus("fixture").state).toBe("stopped");
    expect(() => process.kill(recoveredPid, 0)).toThrow();
  });

  it("bounds startup and call timeouts, records redacted diagnostics, and cleans up failed startup children", async () => {
    const manager = createManager();
    manager.registerServer({
      name: "hanging",
      executable: process.execPath,
      args: [fixture],
      environment: { CHILD_MCP_HANG_INIT: "1", CHILD_MCP_CONFIGURED_VALUE: "secret-canary" },
    });

    await expect(manager.startServer("hanging")).rejects.toMatchObject({ code: "CHILD_MCP_STARTUP_TIMEOUT" });
    const failed = manager.getStatus("hanging");
    expect(failed).toMatchObject({ state: "failed", diagnostic: "timeout", pid: null });
    expect(JSON.stringify(failed)).not.toContain("secret-canary");

    const responsive = createManager();
    responsive.registerServer({ name: "fixture", executable: process.execPath, args: [fixture] });
    await responsive.startServer("fixture");
    await expect(responsive.callTool("fixture", "hang", {})).rejects.toMatchObject({ code: "CHILD_MCP_REQUEST_TIMEOUT" });
    expect(responsive.getStatus("fixture")).toMatchObject({ state: "degraded", diagnostic: "timeout" });
    await expect(responsive.healthServer("fixture")).resolves.toMatchObject({ state: "ready", diagnostic: null });
  });

  it("reaps SIGTERM-resistant descendants through the isolated process group during concurrent shutdown", async () => {
    const manager = createManager();
    manager.registerServer({ name: "fixture", executable: process.execPath, args: [fixture] });
    const started = await manager.startServer("fixture");
    const directPid = started.pid!;

    const descendant = await manager.callTool("fixture", "spawn_descendant");
    const descendantPid = Number((descendant.content[0] as { text: string }).text);
    expect(Number.isInteger(descendantPid)).toBe(true);
    expect(isProcessAlive(descendantPid)).toBe(true);

    await expect(Promise.all([
      manager.stopServer("fixture"),
      manager.stopServer("fixture"),
      manager.stopAll(),
    ])).resolves.toEqual([undefined, undefined, undefined]);
    await waitFor(() => !isProcessAlive(directPid) && !isProcessAlive(descendantPid));
    expect(manager.getStatus("fixture")).toMatchObject({ state: "stopped", pid: null });
  });

  it("surfaces group-shutdown failures and permits an explicit cleanup retry", async () => {
    const manager = createManager();
    manager.registerServer({
      name: "fixture",
      executable: process.execPath,
      args: [fixture],
      environment: { CHILD_MCP_STAY_ALIVE: "1" },
    });
    await manager.startServer("fixture");

    const originalKill = process.kill;
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid < 0 && signal !== 0) {
        const error = Object.assign(new Error("denied"), { code: "EPERM" });
        throw error;
      }
      return originalKill(pid, signal);
    }) as typeof process.kill);

    try {
      await expect(manager.stopAll()).rejects.toMatchObject({ code: "CHILD_MCP_SHUTDOWN_TIMEOUT" });
      expect(manager.getStatus("fixture")).toMatchObject({ state: "failed", diagnostic: "timeout" });
    } finally {
      kill.mockRestore();
    }

    await expect(manager.stopAll()).resolves.toBeUndefined();
    expect(manager.getStatus("fixture")).toMatchObject({ state: "stopped", pid: null });
  });

  it("rejects invalid runtime definitions without exposing their values", () => {
    const manager = createManager();
    const secret = "runtime-definition-secret";
    expect(() => manager.registerServer({
      name: "invalid-name!",
      executable: "node",
      args: [],
      environment: { TOKEN: secret },
    })).toThrow(ChildMcpRuntimeError);
    try {
      manager.registerServer({ name: "valid", executable: "node with-space", args: [] });
      throw new Error("Expected invalid child definition to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "CHILD_MCP_CONFIG_INVALID" });
    }
  });
});
