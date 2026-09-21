import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { PROXY_EVENT_SCHEMA, type FaultPhase } from "./contracts";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
]);

export interface FaultProxyEvent {
  schema: typeof PROXY_EVENT_SCHEMA;
  id: string;
  startedAt: string;
  completedAt: string;
  phase: FaultPhase;
  method: string;
  pathname: string;
  requestBytes: number;
  requestSha256: string;
  disposition: "blocked" | "forwarded" | "response_lost";
  upstreamStatus: number | null;
  upstreamResponseBytes: number | null;
  upstreamResponseSha256: string | null;
}

export interface FaultProxyOptions {
  upstream: string;
  port: number;
  host?: string;
  onEvent?: (event: FaultProxyEvent) => void;
}

function routeKind(method: string, pathname: string): "registration" | "completion" | "quarantine" | "other" {
  if (method === "POST" && pathname.endsWith("/coordination/register")) return "registration";
  if (method === "POST" && pathname.endsWith("/coordination/claims/complete")) return "completion";
  if (method === "POST" && pathname.endsWith("/coordination/claims/quarantine")) return "quarantine";
  return "other";
}

export function faultDisposition(
  phase: FaultPhase,
  method: string,
  pathname: string,
): "blocked" | "forwarded" | "response_lost" {
  const kind = routeKind(method, pathname);
  if (phase === "fail_registration" && kind === "registration") return "blocked";
  if (phase === "lose_completion_response" && kind === "completion") return "response_lost";
  return "forwarded";
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Fault proxy request exceeded the bounded body limit");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function forwardHeaders(headers: IncomingMessage["headers"]): Headers {
  const forwarded = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((entry) => forwarded.append(name, entry));
    else forwarded.set(name, value);
  }
  return forwarded;
}

function responseHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) result[name] = value;
  });
  return result;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
  });
  response.end(serialized);
}

export class CoordinationFaultProxy {
  private readonly upstream: URL;
  private readonly host: string;
  private readonly server: Server;
  private phase: FaultPhase = "pass";
  private events: FaultProxyEvent[] = [];
  private signal?: AbortSignal;

  constructor(private readonly options: FaultProxyOptions) {
    this.upstream = new URL(options.upstream);
    if (!/^https?:$/.test(this.upstream.protocol) || this.upstream.username || this.upstream.password) {
      throw new Error("Fault proxy upstream must be an HTTP(S) URL without credentials");
    }
    this.host = options.host ?? "127.0.0.1";
    if (this.host !== "127.0.0.1" && this.host !== "::1") throw new Error("Fault proxy must bind to loopback");
    if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("Fault proxy port is invalid");
    this.server = createServer((request, response) => { void this.handle(request, response); });
    this.server.requestTimeout = 120_000;
    this.server.headersTimeout = 30_000;
    this.server.keepAliveTimeout = 5_000;
  }

  get url(): string {
    return `http://${this.host === "::1" ? "[::1]" : this.host}:${this.options.port}`;
  }

  setPhase(phase: FaultPhase, signal?: AbortSignal): void {
    (signal ?? this.signal)?.throwIfAborted();
    this.phase = phase;
  }

  getPhase(): FaultPhase {
    return this.phase;
  }

  snapshot(): FaultProxyEvent[] {
    return structuredClone(this.events);
  }

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.signal = signal;
    this.server.listen(this.options.port, this.host);
    await once(this.server, "listening");
    signal.throwIfAborted();
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, "close");
  }

  private record(
    id: string,
    startedAt: string,
    phase: FaultPhase,
    method: string,
    pathname: string,
    body: Buffer,
    disposition: FaultProxyEvent["disposition"],
    upstreamStatus: number | null,
    upstreamResponse?: Buffer,
  ): void {
    const event: FaultProxyEvent = {
      schema: PROXY_EVENT_SCHEMA,
      id,
      startedAt,
      completedAt: new Date().toISOString(),
      phase,
      method,
      pathname,
      requestBytes: body.byteLength,
      requestSha256: createHash("sha256").update(body).digest("hex"),
      disposition,
      upstreamStatus,
      upstreamResponseBytes: upstreamResponse?.byteLength ?? null,
      upstreamResponseSha256: upstreamResponse ? createHash("sha256").update(upstreamResponse).digest("hex") : null,
    };
    this.events.push(event);
    this.options.onEvent?.(structuredClone(event));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.signal?.aborted) {
      sendJson(response, 503, { error: { code: "COORDINATION_HARNESS_ABORTED", message: "Harness aborted" } });
      return;
    }
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const phase = this.phase;
    const method = request.method?.toUpperCase() ?? "GET";
    const requestUrl = new URL(request.url ?? "/", this.upstream);
    const disposition = faultDisposition(phase, method, requestUrl.pathname);
    let body: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    try {
      body = await readBody(request);
      if (disposition === "blocked") {
        this.record(id, startedAt, phase, method, requestUrl.pathname, body, disposition, null);
        sendJson(response, 503, { error: { code: "COORDINATION_HARNESS_REGISTRATION_FAULT", message: "Injected registration outage" } });
        return;
      }

      const upstream = new URL(`${requestUrl.pathname}${requestUrl.search}`, this.upstream);
      const result = await fetch(upstream, {
        method,
        headers: forwardHeaders(request.headers),
        body: method === "GET" || method === "HEAD" ? undefined : Uint8Array.from(body),
        redirect: "manual",
        signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      });
      const responseBody = Buffer.from(await result.arrayBuffer());
      this.record(id, startedAt, phase, method, requestUrl.pathname, body, disposition, result.status, responseBody);
      if (disposition === "response_lost") {
        request.socket.destroy();
        return;
      }
      response.writeHead(result.status, responseHeaders(result));
      response.end(responseBody);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, error instanceof Error && /body limit/.test(error.message) ? 413 : 502, {
          error: { code: "COORDINATION_HARNESS_PROXY_ERROR", message: "Fault proxy could not forward the request" },
        });
      } else {
        response.destroy();
      }
    }
  }
}
