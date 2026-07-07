/** Structured JSON logger for the MCP server, using pino. Log level controlled via LOG_LEVEL env var (default: info). */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  name: "ingenium-server",
});
