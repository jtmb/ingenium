import { Server } from "../schema.js";
/** List all registered MCP servers for a project. */
export declare function listServers(projectId: string): Server[];
/**
 * Register a new MCP server definition.
 * Idempotent: if a server with the same name already exists, returns it unchanged.
 * This is intentional — on container restart, the initialization code may re-register
 * servers that were already persisted, and we don't want to overwrite config.
 */
export declare function registerServer(projectId: string, name: string, command: string, args?: string, env?: string, source?: string): Server;
/**
 * Update a server's runtime status (running/stopped).
 * Currently only supports the `running` field — the `command`/`args`/`env` fields
 * are updated via upsertServer(), not this function.
 */
export declare function updateServer(projectId: string, name: string, fields: {
    running?: number;
}): void;
/**
 * Create or update an MCP server definition.
 * Unlike registerServer (idempotent-only), this explicitly updates an existing server's
 * command/args/env if a match is found — used by the MCP server management UI and
 * config sync to reconcile disk → DB changes.
 */
export declare function upsertServer(projectId: string, name: string, command: string, args?: string, env?: string, source?: string): Server;
/** Delete a server definition by project and name. */
export declare function removeServer(projectId: string, name: string): void;
//# sourceMappingURL=servers.d.ts.map