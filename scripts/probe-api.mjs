/**
 * Authenticated API readiness probe. Reading the credential in Node keeps the
 * bearer value out of curl/process arguments and constrains it to the API port.
 */
import { loadApiToken } from "/app/services/ingenium-api/dist/lib/middleware/api-token.js";

const probeUrl = process.env.INGENIUM_API_PROBE_URL ?? "http://127.0.0.1:4097/api/v1/health";

try {
  const token = loadApiToken(process.env);
  const response = await fetch(probeUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    process.stderr.write(`[healthcheck] API readiness returned ${response.status}\n`);
    process.exit(1);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`[healthcheck] API readiness failed: ${message}\n`);
  process.exit(1);
}
