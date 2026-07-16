/**
 * Register a child MCP server definition.
 * Idempotent — subsequent calls with the same name are ignored (first-wins).
 * Does NOT spawn the process; call startServer() for that.
 */
export declare function registerServer(name: string, command: string, args?: string[], env?: Record<string, string>): void;
/**
 * Spawn a registered child MCP server as a subprocess.
 * No-op if the server is already running.
 *
 * stdio: "pipe" captures stdout/stderr for potential forwarding — the child
 * communicates via its own stdio-based MCP transport, so we don't consume
 * the streams here.
 */
export declare function startServer(name: string): void;
/**
 * Gracefully stop a child MCP server.
 * Uses SIGTERM (not SIGKILL) to give the child a chance to clean up resources.
 * No-op if the server is not registered or not running.
 */
export declare function stopServer(name: string): void;
/** Stop all managed child servers. Called during graceful shutdown to prevent orphaned processes. */
export declare function stopAll(): void;
//# sourceMappingURL=proxy.d.ts.map