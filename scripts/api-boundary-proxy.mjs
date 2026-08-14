/**
 * Loopback API credential boundary.
 *
 * The dashboard, in-container OpenCode plugins, and loopback host MCP clients
 * use this boundary while Express remains private on localhost:4096. The proxy
 * validates each incoming Bearer shape. Scoped credentials are forwarded for
 * API validation; only the installation credential is replaced and marked as
 * an internal compatibility request.
 */
import http from "node:http";
import {
  apiTokensEqual,
  isValidApiToken,
  loadApiToken,
} from "/app/services/ingenium-api/dist/lib/middleware/api-token.js";
import {
  loadRuntimeGatewayToken,
  runtimeGatewayIngressHeaders,
  runtimeGatewayTokensEqual,
} from "/app/services/ingenium-api/dist/lib/runtime-gateway-auth.js";

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
let runtimeGatewayToken = null;
if (process.env.INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE?.trim()) {
  try {
    runtimeGatewayToken = loadRuntimeGatewayToken();
  } catch {
    fail("Runtime gateway token file is unsafe or invalid");
  }
  if (apiTokensEqual(runtimeGatewayToken, token)) fail("Runtime gateway token must be distinct from the installation token");
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

function upstreamHeaders(headers, providedToken, principal) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (hopByHopHeaders.has(normalizedName)
      || normalizedName === "x-ingenium-internal-service"
      || normalizedName === "x-ingenium-private-network"
      || normalizedName === "x-ingenium-runtime-gateway"
      || (normalizedName === "x-ingenium-audience" && principal !== "scoped")
      || value === undefined) continue;
    forwarded[name] = value;
  }

  forwarded.host = `127.0.0.1:${upstreamPort}`;
  forwarded.authorization = `Bearer ${principal === "installation" ? token : providedToken}`;
  if (principal === "installation") forwarded["x-ingenium-internal-service"] = "1";
  return principal === "gateway" ? runtimeGatewayIngressHeaders(forwarded) : forwarded;
}

function incomingBearerToken(headers) {
  const authorization = headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const provided = authorization.slice("Bearer ".length);
  return isValidApiToken(provided) ? provided : null;
}

function rejectUnauthorized(response) {
  response.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": "Bearer",
  });
  response.end('{"error":{"code":"UNAUTHORIZED","message":"Bearer authentication is required"}}');
}

function rejectPrivateRoute(response) {
  response.writeHead(404, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end('{"error":{"code":"NOT_FOUND","message":"Resource not found"}}');
}

const server = http.createServer(
   { headersTimeout: 30_000, requestTimeout: 120_000, maxHeaderSize: 16 * 1024 },
   (request, response) => {
    const providedToken = incomingBearerToken(request.headers);
    if (!providedToken) {
      request.resume();
      rejectUnauthorized(response);
      return;
    }
    const installationRequest = apiTokensEqual(providedToken, token);
    const pathname = new URL(request.url ?? "/", "http://api-boundary").pathname;
    const gatewayPrefix = pathname.startsWith("/api/v1/runtimes/gateway/");
    const gatewayRequest = request.method === "POST"
      && /^\/api\/v1\/runtimes\/gateway\/(exchange|validate)$/.test(pathname)
      && request.headers["x-ingenium-audience"] === "runtime-gateway"
      && runtimeGatewayToken !== null
      && runtimeGatewayTokensEqual(providedToken, runtimeGatewayToken);
    if (gatewayPrefix && !gatewayRequest) {
      request.resume();
      rejectPrivateRoute(response);
      return;
    }
    if (!gatewayPrefix && runtimeGatewayToken !== null && runtimeGatewayTokensEqual(providedToken, runtimeGatewayToken)) {
      request.resume();
      rejectPrivateRoute(response);
      return;
    }
    const principal = gatewayRequest ? "gateway" : installationRequest ? "installation" : "scoped";

    const upstream = http.request({
      host: "127.0.0.1",
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: upstreamHeaders(request.headers, providedToken, principal),
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
