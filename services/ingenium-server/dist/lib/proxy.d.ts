/** Register a child MCP server definition. Idempotent — no-op if already registered. */
export declare function registerServer(name: string, command: string, args?: string[], env?: Record<string, string>): void;
/** Spawn a registered child MCP server. No-op if already running. */
export declare function startServer(name: string): void;
/** Gracefully stop a child MCP server via SIGTERM. No-op if not running. */
export declare function stopServer(name: string): void;
/** Stop all managed child servers. Called during graceful shutdown. */
export declare function stopAll(): void;
//# sourceMappingURL=proxy.d.ts.map