/**
 * Loopback API credential boundary.
 *
 * The dashboard, in-container OpenCode plugins, and loopback host MCP clients
 * use this boundary while Express remains private on localhost:4096. The proxy
 * validates each incoming Bearer credential before replacing it with the
 * upstream credential; network locality alone is never a bypass.
 */
import http from "node:http";
import {
  apiTokensEqual,
  isValidApiToken,
  loadApiToken,
} from "/app/services/ingenium-api/dist/lib/middleware/api-token.js";

const proxyPort = Number(process.env.INGENIUM_API_PROXY_PORT ?? "4097");
const upstreamPort = Number(process.env.INGENIUM_API_UPSTREAM_PORT ?? "4096");

function fail(message) {
  process.stderr.write(`[api-boundary] ${message}\n`);
  process.exit(1);
}

let token;
try {
  token = loadApiToken(process.env);
} catch {
  fail("API token file is missing, unsafe, or invalid");
}
if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
  fail("INGENIUM_API_PROXY_PORT is invalid");
}
if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
  fail("INGENIUM_API_UPSTREAM_PORT is invalid");
}

const hopByHopHeaders = new Set([
  // These headers describe the current connection and must not cross the new
  // proxy hop; authorization is also replaced with the validated upstream token.
  "authorization",
  "proxy-authorization",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function upstreamHeaders(headers) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    if (hopByHopHeaders.has(name.toLowerCase()) || value === undefined) continue;
    forwarded[name] = value;
  }

  // Overwrite any caller-provided credential rather than trusting a host
  // process to carry the container credential correctly.
  forwarded.host = `127.0.0.1:${upstreamPort}`;
  forwarded.authorization = `Bearer ${token}`;
  return forwarded;
}

function incomingBearerToken(headers) {
  const authorization = headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const provided = authorization.slice("Bearer ".length);
  return isValidApiToken(provided) ? provided : null;
}

function rejectUnauthorized(response, statusCode) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(statusCode === 401 ? { "www-authenticate": "Bearer" } : {}),
  });
  response.end(statusCode === 401
    ? '{"error":{"code":"UNAUTHORIZED","message":"Bearer authentication is required"}}'
    : '{"error":{"code":"FORBIDDEN","message":"Invalid authorization token"}}');
}

const server = http.createServer(
   { headersTimeout: 30_000, requestTimeout: 120_000, maxHeaderSize: 16 * 1024 },
   (request, response) => {
    const providedToken = incomingBearerToken(request.headers);
    if (!providedToken) {
      request.resume();
      rejectUnauthorized(response, 401);
      return;
    }
    if (!apiTokensEqual(providedToken, token)) {
      request.resume();
      rejectUnauthorized(response, 403);
      return;
    }

    const upstream = http.request({
      host: "127.0.0.1",
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: upstreamHeaders(request.headers),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });

    upstream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      }
      response.end('{"error":{"code":"API_UNAVAILABLE","message":"API boundary unavailable"}}');
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  },
);

server.listen(proxyPort, "0.0.0.0", () => {
  process.stderr.write(`[api-boundary] listening on 0.0.0.0:${proxyPort}\n`);
});

function shutdown() {
  // Finish active requests when possible, but leave a bounded escape hatch for
  // Supervisor if a client or upstream never closes its connection.
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
