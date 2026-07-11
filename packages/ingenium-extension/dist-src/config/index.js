/** Centralised configuration for the Ingenium MCP server. All values loaded from environment variables with sensible defaults. */
export const config = {
    apiUrl: process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1",
    apiTimeout: parseInt(process.env.INGENIUM_API_TIMEOUT ?? "10000", 10),
    mcpName: "ingenium-server",
    mcpVersion: "0.1.0",
};
