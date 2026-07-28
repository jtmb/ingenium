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
    const category = response.status === 401 || response.status === 403
      ? "authentication failed"
      : "unavailable";
    process.stderr.write(`[healthcheck] API readiness ${category}\n`);
    process.exit(1);
  }
} catch {
  // Transport exceptions can include connection URLs. Keep container logs
  // operationally useful without exposing request details or token sources.
  process.stderr.write("[healthcheck] API readiness unavailable\n");
  process.exit(1);
}
