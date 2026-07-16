/**
 * Structured JSON logger for the MCP server, using pino.
 * Log level controlled via LOG_LEVEL env var (default: info).
 * Writes to stderr by default (pino convention) — critical because the MCP
 * protocol communicates over stdout via StdioServerTransport. Any stray
 * stdout output would corrupt the JSON-RPC message stream.
 */
import pino from "pino";
export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    name: "ingenium-server",
});
