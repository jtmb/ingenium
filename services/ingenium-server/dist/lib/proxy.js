/**
 * Child MCP server manager — spawns and manages sub-processes such as Kaban, Thread, etc.
 * Supports registering, starting, stopping, and shutting down all managed servers.
 */
import { spawn } from "node:child_process";
import { logger } from "./logger.js";
const managedServers = new Map();
/** Register a child MCP server definition. Idempotent — no-op if already registered. */
export function registerServer(name, command, args = [], env) {
    if (managedServers.has(name))
        return;
    managedServers.set(name, { name, command, args, env, process: null });
}
/** Spawn a registered child MCP server. No-op if already running. */
export function startServer(name) {
    const server = managedServers.get(name);
    if (!server)
        throw new Error(`Server '${name}' not registered`);
    if (server.process)
        return; // Already running
    const child = spawn(server.command, server.args, {
        env: { ...process.env, ...server.env },
        stdio: "pipe",
    });
    child.on("error", (err) => {
        logger.error({ name, err }, "Child MCP server failed");
        server.process = null;
    });
    child.on("exit", (code) => {
        logger.info({ name, code }, "Child MCP server exited");
        server.process = null;
    });
    server.process = child;
    logger.info({ name, pid: child.pid }, "Child MCP server started");
}
/** Gracefully stop a child MCP server via SIGTERM. No-op if not running. */
export function stopServer(name) {
    const server = managedServers.get(name);
    if (!server?.process)
        return;
    server.process.kill("SIGTERM");
    server.process = null;
}
/** Stop all managed child servers. Called during graceful shutdown. */
export function stopAll() {
    for (const [name] of managedServers) {
        stopServer(name);
    }
}
