import { readFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";
import { loadRuntimeGatewayToken } from "../lib/runtime-gateway-auth.js";

type Audience = "web" | "cli" | "vscode";
type ActivityKind = "connection_opened" | "connection_closed" | "generation_started" | "generation_finished";
type RuntimeScope = { audience: Audience; runtimeId: string; host: string; origin: string };
type ValidatedSession = {
  backendName: string;
  session: { expiresAt: string; launcherOrigin: string };
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const COOKIE_NAMES: Record<Audience, string> = {
  web: "__Host-ingenium_runtime_web",
  cli: "__Host-ingenium_runtime_cli",
  vscode: "__Host-ingenium_runtime_vscode",
};
const BACKEND_PORTS: Record<Audience, number> = { web: 4098, cli: 4099, vscode: 4100 };
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const PRIVATE_HEADERS = new Set([
  "authorization", "cookie", "forwarded", "proxy-authorization", "x-authenticated-user", "x-auth-request-user",
  "x-client-identity", "x-forwarded-client-cert", "x-forwarded-email", "x-forwarded-for", "x-forwarded-host",
  "x-forwarded-port", "x-forwarded-prefix", "x-forwarded-proto", "x-forwarded-server", "x-forwarded-user",
  "x-ingenium-authenticated-user", "x-ingenium-audience", "x-ingenium-internal-service",
  "x-ingenium-launcher-worktree", "x-ingenium-private-network", "x-ingenium-runtime-gateway",
  "x-ingenium-workspace", "x-original-url", "x-real-ip", "x-remote-user", "x-rewrite-url", "x-user",
]);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rootDomain(): string {
  const value = required("INGENIUM_RUNTIME_ROOT_DOMAIN").toLowerCase().replace(/^\./, "");
  if (value.length > 200 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(value) || value.includes("..") || !value.includes(".")) {
    throw new Error("INGENIUM_RUNTIME_ROOT_DOMAIN is invalid");
  }
  return value;
}

function dashboardOrigins(): Set<string> {
  const values = required("DASHBOARD_ALLOWED_ORIGINS").split(",").map((value) => value.trim());
  const result = new Set<string>();
  for (const value of values) {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password) throw new Error("DASHBOARD_ALLOWED_ORIGINS is invalid");
    result.add(value);
  }
  return result;
}

export function runtimeScope(request: Pick<IncomingMessage, "headers">): RuntimeScope | undefined {
  const host = request.headers.host?.toLowerCase();
  if (!host || host.includes(":")) return undefined;
  const match = new RegExp(`^(web|cli|vscode)--(${UUID})\\.${rootDomain().replaceAll(".", "\\.")}$`).exec(host);
  if (!match) return undefined;
  return { audience: match[1] as Audience, runtimeId: match[2]!, host, origin: `https://${host}` };
}

function cookie(request: IncomingMessage, name: string): string | undefined {
  for (const part of request.headers.cookie?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function gatewayRequestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Ingenium-Audience": "runtime-gateway",
  };
}

function gatewayApi<T>(path: string, body: unknown): Promise<{ status: number; data?: T; error?: unknown }> {
  const url = new URL(path, required("INGENIUM_RUNTIME_API_URL"));
  if (url.protocol !== "http:" || url.username || url.password) throw new Error("INGENIUM_RUNTIME_API_URL is invalid");
  return fetch(url, {
    method: "POST",
    headers: gatewayRequestHeaders(loadRuntimeGatewayToken()),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  }).then(async (response) => ({ status: response.status, ...await response.json().catch(() => ({})) }));
}

async function validate(scope: RuntimeScope, token: string): Promise<ValidatedSession | undefined> {
  const result = await gatewayApi<ValidatedSession>("runtimes/gateway/validate", {
    sessionToken: token,
    audience: scope.audience,
    origin: scope.origin,
    host: scope.host,
  });
  return result.status === 200 && result.data?.backendName ? result.data : undefined;
}

async function recordActivity(scope: RuntimeScope, token: string, kind: ActivityKind): Promise<boolean> {
  const result = await gatewayApi<{ accepted?: boolean }>("runtimes/gateway/activity", {
    sessionToken: token,
    audience: scope.audience,
    origin: scope.origin,
    host: scope.host,
    kind,
  });
  return result.status === 200 && result.data?.accepted === true;
}

export function isRuntimeHealthRequest(request: Pick<IncomingMessage, "method" | "url">): boolean {
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") return false;
  const pathname = new URL(request.url ?? "/", "https://runtime.invalid").pathname.toLowerCase();
  return /\/(?:health|healthz|status)$/.test(pathname);
}

export function isRuntimeGenerationRequest(request: Pick<IncomingMessage, "method" | "url">): boolean {
  if (request.method !== "POST") return false;
  const pathname = new URL(request.url ?? "/", "https://runtime.invalid").pathname;
  return /^\/session\/[^/]+\/(?:message|prompt|prompt_async|command)$/.test(pathname);
}

function framePolicy(origin?: string): string {
  if (origin === undefined) return "frame-ancestors 'none'";
  if (!dashboardOrigins().has(origin)) throw new Error("Dashboard origin is not allowed");
  return `frame-ancestors ${origin}`;
}

function reject(response: ServerResponse, status = 401, message = "Authentication is required", origin?: string): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": `${framePolicy(origin)}; default-src 'none'`,
    "X-Content-Type-Options": "nosniff",
  }).end(message);
}

export function sanitizedHeaders(headers: IncomingHttpHeaders, scope: RuntimeScope, websocket = false): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (PRIVATE_HEADERS.has(lower) || (!websocket && HOP_HEADERS.has(lower)) || lower === "host" || lower === "origin" || lower === "referer") continue;
    result[lower] = value;
  }
  result.host = scope.host;
  if (scope.audience === "cli") result["x-ingenium-authenticated-user"] = "runtime";
  if (websocket) {
    result.connection = "Upgrade";
    result.upgrade = "websocket";
    result.origin = scope.origin;
  }
  return result;
}

function exchange(request: IncomingMessage, response: ServerResponse, scope: RuntimeScope): void {
  const requestOrigin = request.headers.origin;
  if (request.method === "OPTIONS" && requestOrigin && dashboardOrigins().has(requestOrigin)) {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": requestOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    }).end();
    return;
  }
  if (request.method !== "POST" || !requestOrigin || !dashboardOrigins().has(requestOrigin)
    || request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
    reject(response, 403, "Runtime launch origin is not allowed");
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  request.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 4_096) request.destroy();
    else chunks.push(chunk);
  });
  request.on("end", async () => {
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { proof?: unknown };
      if (typeof parsed.proof !== "string") return reject(response, 401, "Runtime launch proof is invalid");
      const result = await gatewayApi<{ sessionToken?: string; session?: { expiresAt?: string } }>("runtimes/gateway/exchange", {
        exchangeProof: parsed.proof,
        audience: scope.audience,
        origin: scope.origin,
        host: scope.host,
        launcherOrigin: requestOrigin,
      });
      const sessionToken = result.data?.sessionToken;
      const expiresAt = result.data?.session?.expiresAt;
      if (result.status !== 200 || !sessionToken || !expiresAt) return reject(response, 401, "Runtime launch ticket is invalid or expired");
      const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1_000));
      response.writeHead(204, {
        "Access-Control-Allow-Origin": requestOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Cache-Control": "no-store",
        "Set-Cookie": runtimeCookie(scope.audience, sessionToken, maxAge),
        Vary: "Origin",
      }).end();
    } catch {
      reject(response, 401, "Runtime launch ticket is invalid or expired");
    }
  });
}

export function proxyResponseHeaders(
  headers: IncomingHttpHeaders,
  scope: RuntimeScope,
  launcherOrigin: string,
): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (HOP_HEADERS.has(lower) || lower === "set-cookie" || lower === "x-frame-options" || lower === "content-security-policy") continue;
    if (lower === "location" && typeof value === "string") {
      result.location = value.replace(/^http:\/\/[^/]+/, scope.origin);
    } else result[lower] = value;
  }
  const upstreamPolicy = headers["content-security-policy"];
  const policies = (Array.isArray(upstreamPolicy) ? upstreamPolicy : upstreamPolicy ? [upstreamPolicy] : [])
    .map((policy) => policy.split(";").map((directive) => directive.trim())
      .filter((directive) => directive && !directive.toLowerCase().startsWith("frame-ancestors ")).join("; "))
    .filter(Boolean);
  result["content-security-policy"] = [...policies, framePolicy(launcherOrigin)];
  result["x-content-type-options"] = "nosniff";
  return result;
}

export function runtimeCookie(audience: Audience, token: string, maxAge: number): string {
  if (!/^rbs_[A-Za-z0-9_-]{43}$/.test(token) || !Number.isSafeInteger(maxAge) || maxAge < 1) throw new Error("Invalid runtime cookie");
  // The dashboard and runtime roots are intentionally cross-site; Strict would drop the
  // audience cookie on the health request and iframe while __Host- keeps it host-only.
  return `${COOKIE_NAMES[audience]}=${token}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=${maxAge}`;
}

export function runtimeBackendHealthPath(audience: Audience): string {
  return audience === "vscode" ? "/?folder=/workspace" : "/";
}

async function backendReady(scope: RuntimeScope, backendName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const upstream = httpRequest({
      hostname: backendName,
      port: BACKEND_PORTS[scope.audience],
      method: "GET",
      path: runtimeBackendHealthPath(scope.audience),
      headers: sanitizedHeaders({}, scope),
      timeout: 5_000,
    }, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 400);
    });
    upstream.once("timeout", () => upstream.destroy());
    upstream.once("error", () => resolve(false));
    upstream.end();
  });
}

async function health(request: IncomingMessage, response: ServerResponse, scope: RuntimeScope): Promise<void> {
  const origin = request.headers.origin;
  if (request.method !== "GET" || !origin || !dashboardOrigins().has(origin)) {
    reject(response, 403, "Runtime health origin is not allowed");
    return;
  }
  const token = cookie(request, COOKIE_NAMES[scope.audience]);
  const resolved = token ? await validate(scope, token).catch(() => undefined) : undefined;
  if (!resolved || origin !== resolved.session.launcherOrigin || !await backendReady(scope, resolved.backendName)) {
    reject(response, 503, "Runtime audience is unavailable", origin);
    return;
  }
  response.writeHead(204, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store",
    "Content-Security-Policy": framePolicy(origin),
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  }).end();
}

async function proxyHttp(request: IncomingMessage, response: ServerResponse, scope: RuntimeScope): Promise<void> {
  const token = cookie(request, COOKIE_NAMES[scope.audience]);
  if (!token) return reject(response);
  const suppliedOrigin = request.headers.origin;
  if (suppliedOrigin && suppliedOrigin !== scope.origin) return reject(response, 403, "Runtime request origin is not allowed");
  const resolved = await validate(scope, token).catch(() => undefined);
  if (!resolved) return reject(response);
  const tracked = !isRuntimeHealthRequest(request);
  const generation = tracked && isRuntimeGenerationRequest(request);
  if (tracked && !await recordActivity(scope, token, "connection_opened").catch(() => false)) return reject(response);
  if (generation && !await recordActivity(scope, token, "generation_started").catch(() => false)) {
    await recordActivity(scope, token, "connection_closed").catch(() => false);
    return reject(response);
  }
  let finished = false;
  const finish = () => {
    if (!tracked || finished) return;
    finished = true;
    void (async () => {
      if (generation) await recordActivity(scope, token, "generation_finished").catch(() => false);
      await recordActivity(scope, token, "connection_closed").catch(() => false);
    })();
  };
  const upstream = httpRequest({
    hostname: resolved.backendName,
    port: BACKEND_PORTS[scope.audience],
    method: request.method,
    path: request.url,
    headers: sanitizedHeaders(request.headers, scope),
    timeout: 30_000,
  }, (upstreamResponse) => {
    response.writeHead(
      upstreamResponse.statusCode ?? 502,
      proxyResponseHeaders(upstreamResponse.headers, scope, resolved.session.launcherOrigin),
    );
    upstreamResponse.pipe(response);
  });
  const recheck = setInterval(() => {
    void validate(scope, token).then((current) => { if (!current) upstream.destroy(); }).catch(() => upstream.destroy());
  }, 5_000);
  recheck.unref();
  const clear = () => { clearInterval(recheck); finish(); };
  response.on("close", finish);
  request.on("aborted", finish);
  upstream.on("close", clear);
  upstream.on("error", () => { clear(); if (!response.headersSent) reject(response, 502, "Runtime backend is unavailable"); else response.destroy(); });
  request.pipe(upstream);
}

async function proxyWebSocket(request: IncomingMessage, socket: Duplex, head: Buffer, scope: RuntimeScope): Promise<void> {
  const token = cookie(request, COOKIE_NAMES[scope.audience]);
  if (!token || (request.headers.origin !== undefined && request.headers.origin !== scope.origin)) {
    socket.destroy();
    return;
  }
  const resolved = await validate(scope, token).catch(() => undefined);
  if (!resolved) {
    socket.destroy();
    return;
  }
  const upstream = httpRequest({
    hostname: resolved.backendName,
    port: BACKEND_PORTS[scope.audience],
    method: request.method,
    path: request.url,
    headers: sanitizedHeaders(request.headers, scope, true),
  });
  upstream.on("upgrade", async (upstreamResponse, upstreamSocket, upstreamHead) => {
    if (!await recordActivity(scope, token, "connection_opened").catch(() => false)) {
      socket.destroy();
      upstreamSocket.destroy();
      return;
    }
    let closed = false;
    const closeActivity = () => {
      if (closed) return;
      closed = true;
      void recordActivity(scope, token, "connection_closed").catch(() => false);
    };
    if (socket.destroyed || upstreamSocket.destroyed) {
      closeActivity();
      socket.destroy();
      upstreamSocket.destroy();
      return;
    }
    const lines = [`HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? "Switching Protocols"}`];
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (value !== undefined && !PRIVATE_HEADERS.has(name.toLowerCase())) lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
    const recheck = setInterval(() => {
      void validate(scope, token).then((current) => { if (!current) { socket.destroy(); upstreamSocket.destroy(); } })
        .catch(() => { socket.destroy(); upstreamSocket.destroy(); });
    }, 5_000);
    recheck.unref();
    socket.on("close", () => { clearInterval(recheck); closeActivity(); });
    upstreamSocket.on("close", closeActivity);
  });
  upstream.on("response", () => socket.destroy());
  upstream.on("error", () => socket.destroy());
  upstream.end();
}

export function startRuntimeGateway() {
  rootDomain();
  dashboardOrigins();
  loadRuntimeGatewayToken();
  const port = Number(process.env.INGENIUM_RUNTIME_GATEWAY_PORT ?? "8443");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) throw new Error("INGENIUM_RUNTIME_GATEWAY_PORT is invalid");
  const server = createServer({
    cert: readFileSync(required("INGENIUM_RUNTIME_TLS_CERT_FILE")),
    key: readFileSync(required("INGENIUM_RUNTIME_TLS_KEY_FILE")),
    minVersion: "TLSv1.2",
  }, (request, response) => {
    const scope = runtimeScope(request);
    if (!scope) {
      reject(response, 421, "Runtime host is not recognized");
      return;
    }
    if (request.url === "/__ingenium/exchange") {
      exchange(request, response, scope);
      return;
    }
    if (request.url === "/__ingenium/health") {
      void health(request, response, scope);
      return;
    }
    void proxyHttp(request, response, scope);
  });
  server.on("upgrade", (request, socket, head) => {
    const scope = runtimeScope(request);
    if (!scope || request.url === "/__ingenium/exchange") {
      socket.destroy();
      return;
    }
    void proxyWebSocket(request, socket, head, scope);
  });
  server.listen(port, "0.0.0.0");
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) startRuntimeGateway();
