/**
 * Child MCP server manager — spawns and manages registered sub-processes.
 * Supports registering, starting, stopping, and shutting down all managed servers.
 */
import { spawn } from "node:child_process";
import { logger } from "./logger.js";
// Map-based registry for O(1) lookups by server name. Not exported — all
// lifecycle operations go through the exported functions below.
const managedServers = new Map();
/**
 * Register a child MCP server definition.
 * Idempotent — subsequent calls with the same name are ignored (first-wins).
 * Does NOT spawn the process; call startServer() for that.
 */
export function registerServer(name, command, args = [], env) {
    if (managedServers.has(name))
        return;
    managedServers.set(name, { name, command, args, env, process: null });
}
/**
 * Spawn a registered child MCP server as a subprocess.
 * No-op if the server is already running.
 *
 * stdio: "pipe" captures stdout/stderr for potential forwarding — the child
 * communicates via its own stdio-based MCP transport, so we don't consume
 * the streams here.
 */
export function startServer(name) {
    const server = managedServers.get(name);
    if (!server)
        throw new Error(`Server '${name}' not registered`);
    if (server.process)
        return;
    const child = spawn(server.command, server.args, {
        env: { ...process.env, ...server.env },
        stdio: "pipe",
    });
    child.on("error", (err) => {
        logger.error({ name, err }, "Child MCP server failed");
        server.process = null;
    });
    // NOTE: No auto-restart on exit. If the child crashes, the parent does NOT
    // re-spawn — the user must explicitly restart via the dashboard or tools.
    // This avoids infinite restart loops for misconfigured servers.
    child.on("exit", (code) => {
        logger.info({ name, code }, "Child MCP server exited");
        server.process = null;
    });
    server.process = child;
    logger.info({ name, pid: child.pid }, "Child MCP server started");
}
/**
 * Gracefully stop a child MCP server.
 * Uses SIGTERM (not SIGKILL) to give the child a chance to clean up resources.
 * No-op if the server is not registered or not running.
 */
export function stopServer(name) {
    const server = managedServers.get(name);
    if (!server?.process)
        return;
    server.process.kill("SIGTERM");
    server.process = null;
}
/** Stop all managed child servers. Called during graceful shutdown to prevent orphaned processes. */
export function stopAll() {
    for (const [name] of managedServers) {
        stopServer(name);
    }
}
