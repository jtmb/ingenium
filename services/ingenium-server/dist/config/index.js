/**
 * Centralised configuration for the Ingenium MCP server.
 * All values loaded from environment variables with sensible defaults.
 * NOTE: This service has ZERO direct DB access — all data flows through API.
 */
export const config = {
    /** Base URL of the Ingenium REST API (port 4097, NOT 3000/4098/4099). */
    apiUrl: process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1",
    /** Request timeout in ms. 10s default — generous for LLM-backed endpoints but short enough to avoid cascading stalls. */
    apiTimeout: parseInt(process.env.INGENIUM_API_TIMEOUT ?? "10000", 10),
    /** MCP server identity — used in protocol handshake and capability advertisement. */
    mcpName: "ingenium-server",
    mcpVersion: "0.1.0",
};
