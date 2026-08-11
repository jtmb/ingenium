import { promises as dns } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// 8192-token LLM JSON responses fit comfortably below this exclusive ceiling.
export const LLM_RESPONSE_BODY_MAX_BYTES = 1_048_576;
const RESPONSE_BODY_LIMIT_ERROR = "endpoint response body exceeds the allowed size";

export { isIP } from "node:net";

export interface EndpointPolicyOptions {
  allowPrivateNetwork: boolean;
  timeoutMs?: number;
}

interface PinnedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

interface PinnedEndpoint {
  readonly url: URL;
  readonly hostname: string;
  readonly addresses: readonly PinnedAddress[];
}

interface PreparedRequest {
  method: string;
  body?: Buffer;
  headers: Headers;
}

interface TransportResponse {
  readonly response: IncomingMessage;
  readonly status: number;
  cleanup(): void;
}

function normalizeHostname(hostname: string): string {
  const unbracketed = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  const normalized = unbracketed.toLowerCase().replace(/\.+$/, "");
  if (!normalized) throw new Error("endpoint host is invalid");
  return normalized;
}

function parseEndpointUrl(endpoint: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("endpoint must be a valid HTTP(S) URL");
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new Error("endpoint must be an HTTP(S) URL without embedded credentials");
  }

  normalizeHostname(parsed.hostname);
  return parsed;
}

function parseIPv4(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  return address.split(".").map(Number);
}

function parseIPv6(address: string): Uint8Array | undefined {
  if (isIP(address) !== 6) return undefined;

  let value = address.toLowerCase();
  if (value.includes("%")) return undefined;

  if (value.includes(".")) {
    const separator = value.lastIndexOf(":");
    const ipv4 = parseIPv4(value.slice(separator + 1));
    if (!ipv4) return undefined;
    value = `${value.slice(0, separator + 1)}${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }

  const compression = value.indexOf("::");
  if (compression !== value.lastIndexOf("::")) return undefined;

  const head = compression === -1 ? value : value.slice(0, compression);
  const tail = compression === -1 ? "" : value.slice(compression + 2);
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  if (headParts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
    || tailParts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return undefined;
  }

  const missing = 8 - headParts.length - tailParts.length;
  if ((compression === -1 && missing !== 0) || (compression !== -1 && missing < 1)) return undefined;

  const parts = [...headParts, ...Array<string>(Math.max(0, missing)).fill("0"), ...tailParts];
  if (parts.length !== 8) return undefined;

  const bytes = new Uint8Array(16);
  for (let index = 0; index < parts.length; index += 1) {
    const value = Number.parseInt(parts[index]!, 16);
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((part, index) => bytes[index] === part);
}

function isPrivateIPv4(address: string): boolean {
  const octets = parseIPv4(address);
  if (!octets) return true;
  const [first, second, third] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second! >= 64 && second! <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second! >= 16 && second! <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first! >= 224;
}

function isPrivateIPv6(address: string): boolean {
  const bytes = parseIPv6(address);
  if (!bytes) return true;

  const unspecified = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (unspecified || loopback) return true;

  const ipv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  const ipv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff
    && bytes[11] === 0xff;
  if (ipv4Compatible || ipv4Mapped) {
    return isPrivateIPv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }

  return (bytes[0]! & 0xfe) === 0xfc
    || (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80)
    || (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0)
    || bytes[0] === 0xff
    || hasPrefix(bytes, [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    || hasPrefix(bytes, [0x64, 0xff, 0x9b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    || hasPrefix(bytes, [0x64, 0xff, 0x9b, 0x01, 0x00, 0x00])
    || (bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2]! & 0xf8) === 0)
    || hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8])
    || hasPrefix(bytes, [0x20, 0x02]);
}

export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const addressType = isIP(normalized);
  if (addressType === 4) return isPrivateIPv4(normalized);
  if (addressType === 6) return isPrivateIPv6(normalized);
  return false;
}

async function resolveEndpoint(endpoint: string, allowPrivateNetwork: boolean): Promise<PinnedEndpoint> {
  const url = parseEndpointUrl(endpoint);
  const hostname = normalizeHostname(url.hostname);

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("endpoint host could not be resolved");
  }

  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error("endpoint host could not be resolved");
  }

  let privateAddress = hostname === "localhost" || hostname.endsWith(".localhost");
  const addresses: PinnedAddress[] = [];
  for (const answer of answers) {
    const address = normalizeHostname(answer.address);
    const family = isIP(address);
    if ((family !== 4 && family !== 6) || answer.family !== family) {
      throw new Error("endpoint host returned an invalid address");
    }
    privateAddress ||= isPrivateAddress(address);
    addresses.push(Object.freeze({ address, family }));
  }

  if (!allowPrivateNetwork && privateAddress) {
    throw new Error("endpoint points to an internal/private network address");
  }

  return Object.freeze({
    url,
    hostname,
    addresses: Object.freeze(addresses),
  });
}

export async function validateEndpointUrl(endpoint: string, allowPrivate: boolean): Promise<void> {
  await resolveEndpoint(endpoint, allowPrivate);
}

function logicalHostHeader(url: URL, hostname: string): string {
  const host = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return url.port ? `${host}:${url.port}` : host;
}

function originKey(url: URL): string {
  const hostname = normalizeHostname(url.hostname);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.protocol}//${isIP(hostname) === 6 ? `[${hostname}]` : hostname}:${port}`;
}

function isCrossOriginCredentialHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "authorization"
    || normalized === "proxy-authorization"
    || normalized === "cookie"
    || normalized === "cookie2"
    || normalized === "content-authorization"
    || normalized === "content-authentication"
    || (normalized.startsWith("content-") && /(?:auth|credential|token)/.test(normalized));
}

function stripCrossOriginCredentials(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    if (isCrossOriginCredentialHeader(name)) headers.delete(name);
  }
}

function stripBodyHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    if (name.startsWith("content-") || name === "transfer-encoding") headers.delete(name);
  }
}

function prepareHeaders(init: RequestInit, body?: Buffer): Headers {
  const headers = new Headers(init.headers);
  if (headers.has("host")) throw new Error("caller-supplied Host header is not allowed");
  headers.delete("transfer-encoding");
  headers.delete("content-length");
  if (body) headers.set("content-length", String(body.length));
  return headers;
}

async function prepareBody(body: RequestInit["body"]): Promise<Buffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  throw new Error("endpoint request body must be replayable; streams are not allowed");
}

function requestAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("endpoint request was aborted");
  error.name = "AbortError";
  return error;
}

function pinnedLookup(endpoint: PinnedEndpoint) {
  return (
    hostname: string,
    options: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    try {
      if (normalizeHostname(hostname) !== endpoint.hostname) {
        throw new Error("endpoint transport requested an unexpected hostname");
      }
      const address = endpoint.addresses[0];
      if (!address) throw new Error("endpoint host could not be resolved");
      if (options.all) {
        const immutableAddresses = Object.freeze(endpoint.addresses.map((pinned) => Object.freeze({
          address: pinned.address,
          family: pinned.family,
        })));
        callback(null, immutableAddresses as unknown as Array<{ address: string; family: number }>);
      }
      else callback(null, address.address, address.family);
    } catch (error) {
      callback(error as NodeJS.ErrnoException, "", 0);
    }
  };
}

function responseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.append(name, value);
    }
  }
  return headers;
}

function requestPinnedEndpoint(
  endpoint: PinnedEndpoint,
  request: PreparedRequest,
  signal: AbortSignal,
): Promise<TransportResponse> {
  return new Promise<TransportResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(requestAbortReason(signal));
      return;
    }

    const headers = new Headers(request.headers);
    headers.set("host", logicalHostHeader(endpoint.url, endpoint.hostname));
    const options = {
      protocol: endpoint.url.protocol,
      hostname: endpoint.hostname,
      port: endpoint.url.port || undefined,
      path: `${endpoint.url.pathname || "/"}${endpoint.url.search}`,
      method: request.method,
      headers: Object.fromEntries(headers.entries()),
      lookup: pinnedLookup(endpoint),
      agent: false,
      ...(endpoint.url.protocol === "https:" && isIP(endpoint.hostname) === 0
        ? { servername: endpoint.hostname }
        : {}),
    };
    const issueRequest = endpoint.url.protocol === "https:" ? httpsRequest : httpRequest;
    let clientRequest: ReturnType<typeof httpRequest> | undefined;
    let settled = false;
    function cleanup(): void {
      signal.removeEventListener("abort", abort);
    }
    function finish(callback: () => void, retainAbort = false): void {
      if (settled) return;
      settled = true;
      if (!retainAbort) cleanup();
      callback();
    }
    function abort(): void {
      const reason = requestAbortReason(signal);
      clientRequest?.destroy(reason);
      finish(() => reject(reason));
    }
    clientRequest = issueRequest(options, (response) => {
      finish(() => resolve({ response, status: response.statusCode ?? 0, cleanup }), true);
    });
    clientRequest.once("error", (error) => finish(() => reject(error)));
    if (!settled) signal.addEventListener("abort", abort, { once: true });
    if (request.body) clientRequest.end(request.body);
    else clientRequest.end();
  });
}

function drainResponse(response: IncomingMessage): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    response.once("end", resolve);
    response.once("error", reject);
    response.once("aborted", () => reject(new Error("endpoint response was aborted")));
    response.resume();
  });
}

function responseBodyLimitError(): Error {
  return new Error(RESPONSE_BODY_LIMIT_ERROR);
}

function declaredResponseBodyExceedsLimit(response: IncomingMessage): boolean {
  const header = response.headers["content-length"];
  if (typeof header !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(header)) return false;
  const length = Number(header);
  return !Number.isSafeInteger(length) || length >= LLM_RESPONSE_BODY_MAX_BYTES;
}

function cancelResponse(response: IncomingMessage): void {
  response.destroy();
  response.socket?.destroy();
}

function readResponse(response: IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    if (declaredResponseBodyExceedsLimit(response)) {
      cancelResponse(response);
      reject(responseBodyLimitError());
      return;
    }

    const body = new Uint8Array(new ArrayBuffer(LLM_RESPONSE_BODY_MAX_BYTES));
    let byteLength = 0;
    let settled = false;
    const cleanup = (): void => {
      response.removeListener("data", onData);
      response.removeListener("end", onEnd);
      response.removeListener("error", onError);
      response.removeListener("aborted", onAborted);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | Uint8Array | string): void => {
      const chunkLength = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (chunkLength >= LLM_RESPONSE_BODY_MAX_BYTES - byteLength) {
        fail(responseBodyLimitError());
        cancelResponse(response);
        return;
      }
      body.set(typeof chunk === "string" ? Buffer.from(chunk) : chunk, byteLength);
      byteLength += chunkLength;
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body.subarray(0, byteLength));
    };
    const onError = (error: Error): void => fail(error);
    const onAborted = (): void => fail(new Error("endpoint response was aborted"));

    response.on("data", onData);
    response.once("end", onEnd);
    response.once("error", onError);
    response.once("aborted", onAborted);
    response.resume();
  });
}

function redirectRequest(
  status: number,
  request: PreparedRequest,
  previousUrl: URL,
  nextUrl: URL,
): PreparedRequest {
  const headers = new Headers(request.headers);
  let method = request.method;
  let body = request.body;

  if ((status === 301 || status === 302 || status === 303) && method === "POST") {
    method = "GET";
    body = undefined;
    stripBodyHeaders(headers);
  } else if (status === 303 && method !== "GET" && method !== "HEAD") {
    method = "GET";
    body = undefined;
    stripBodyHeaders(headers);
  }

  if (originKey(previousUrl) !== originKey(nextUrl)) stripCrossOriginCredentials(headers);
  headers.delete("host");
  headers.delete("transfer-encoding");
  headers.delete("content-length");
  if (body) headers.set("content-length", String(body.length));
  return { method, body, headers };
}

export async function safeLlmFetch(url: string, init: RequestInit, policy: EndpointPolicyOptions): Promise<Response> {
  const body = await prepareBody(init.body);
  const method = (init.method ?? "GET").toUpperCase();
  if (!/^[A-Z]+$/.test(method)) throw new Error("endpoint request method is invalid");
  if ((method === "GET" || method === "HEAD") && body) {
    throw new Error("endpoint GET and HEAD requests cannot include a body");
  }

  const timeout = AbortSignal.timeout(policy.timeoutMs ?? 60_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let currentUrl = parseEndpointUrl(url);
  let request: PreparedRequest = {
    method,
    body,
    headers: prepareHeaders(init, body),
  };

  for (let redirects = 0; ; redirects += 1) {
    const endpoint = await resolveEndpoint(currentUrl.toString(), policy.allowPrivateNetwork);
    const transport = await requestPinnedEndpoint(endpoint, request, signal);
    const location = transport.response.headers.location;

    if (!REDIRECT_STATUSES.has(transport.status) || !location) {
      try {
        const responseBody = await readResponse(transport.response);
        return new Response(responseBody, {
          status: transport.status,
          statusText: transport.response.statusMessage,
          headers: responseHeaders(transport.response),
        });
      } finally {
        transport.cleanup();
      }
    }

    try {
      await drainResponse(transport.response);
    } finally {
      transport.cleanup();
    }
    if (redirects >= MAX_REDIRECTS) throw new Error("endpoint redirected too many times");

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
      parseEndpointUrl(nextUrl.toString());
    } catch {
      throw new Error("endpoint redirect location is invalid");
    }
    request = redirectRequest(transport.status, request, currentUrl, nextUrl);
    currentUrl = nextUrl;
  }
}
