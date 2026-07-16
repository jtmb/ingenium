/**
 * Application configuration — populated from environment variables with sensible defaults.
 *
 * - port:       4097 — non-privileged, avoids requiring root in container
 * - rateLimit:  100 req/min per IP — conservative, tuned for agentic workloads not human browsing
 * - corsOrigin: defaults to "http://localhost:3000" — set explicitly via CORS_ORIGIN env var for deployments needing another origin
 * - coreDbPath: containerized deployments MUST set INGENIUM_CORE_DB_PATH (e.g. /app/.ingenium/data).
 *               Falls back to <cwd>/.ingenium/data.db for host development.
 */
export declare const config: {
    port: number;
    rateLimit: number;
    corsOrigin: string;
    coreDbPath: string;
};
//# sourceMappingURL=index.d.ts.map