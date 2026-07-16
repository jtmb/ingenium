import { resolve } from "node:path";

/**
 * Application configuration — populated from environment variables with sensible defaults.
 *
 * - port:       4097 — non-privileged, avoids requiring root in container
 * - rateLimit:  100 req/min per IP — conservative, tuned for agentic workloads not human browsing
 * - corsOrigin: defaults to "http://localhost:3000" — set explicitly via CORS_ORIGIN env var for deployments needing another origin
 * - coreDbPath: containerized deployments MUST set INGENIUM_CORE_DB_PATH (e.g. /app/.ingenium/data).
 *               Falls back to <cwd>/.ingenium/data.db for host development.
 */
export const config = {
  port: parseInt(process.env.INGENIUM_API_PORT ?? "4097", 10),
  rateLimit: parseInt(process.env.INGENIUM_API_RATE_LIMIT ?? "100", 10),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  coreDbPath: process.env.INGENIUM_CORE_DB_PATH ?? resolve(process.cwd(), ".ingenium", "data.db"),
};
