/**
 * Centralised configuration for the Ingenium MCP server.
 * All values loaded from environment variables with sensible defaults.
 * NOTE: This service has ZERO direct DB access — all data flows through API.
 */
export declare const config: {
    /** Base URL of the Ingenium REST API (port 4097, NOT 3000/4098/4099). */
    apiUrl: string;
    /** Request timeout in ms. 10s default — generous for LLM-backed endpoints but short enough to avoid cascading stalls. */
    apiTimeout: number;
    /** MCP server identity — used in protocol handshake and capability advertisement. */
    mcpName: string;
    mcpVersion: string;
};
//# sourceMappingURL=index.d.ts.map