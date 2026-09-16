import { promises as dns } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const DEFAULT_MAX_REDIRECTS = 10;
const DEFAULT_TIMEOUT_MS = 60_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// 8192-token LLM JSON responses fit comfortably below this exclusive ceiling.
export const LLM_RESPONSE_BODY_MAX_BYTES = 1_048_576;

export type EndpointPolicyErrorCode =
  | "aborted"
  | "content_encoding"
  | "content_type"
  | "dns"
  | "invalid_response"
  | "invalid_url"
  | "network"
  | "private_address"
  | "redirect"
  | "request_too_large"
  | "response_too_large"
  | "timeout";

export class EndpointPolicyError extends Error {
  constructor(
    public readonly code: EndpointPolicyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EndpointPolicyError";
  }
}

export interface EndpointPolicyOptions {
  allowPrivateNetwork: boolean;
  allowedPorts?: readonly number[];
  allowedProtocols?: readonly ("http:" | "https:")[];
  allowedRequestContentTypes?: readonly string[];
  allowedResponseContentTypes?: readonly string[];
  maxRedirects?: number;
  maxRequestBodyBytes?: number;
  maxResponseBodyBytes?: number;
  rejectEncodedResponses?: boolean;
  rejectFragments?: boolean;
  rejectIpLiterals?: boolean;
  rejectTrailingDot?: boolean;
  requireDnsHostname?: boolean;
  timeoutMs?: number;
}

interface NormalizedEndpointPolicy {
  readonly allowPrivateNetwork: boolean;
  readonly allowedPorts?: ReadonlySet<number>;
  readonly allowedProtocols: ReadonlySet<"http:" | "https:">;
  readonly allowedRequestContentTypes?: readonly string[];
  readonly allowedResponseContentTypes?: readonly string[];
  readonly maxRedirects: number;
  readonly maxRequestBodyBytes?: number;
  readonly maxResponseBodyBytes: number;
  readonly rejectEncodedResponses: boolean;
  readonly rejectFragments: boolean;
  readonly rejectIpLiterals: boolean;
  readonly rejectTrailingDot: boolean;
  readonly requireDnsHostname: boolean;
  readonly timeoutMs: number;
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

export { isIP } from "node:net";

function positiveInteger(value: number | undefined, fallback: number, name: string, allowZero = false): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < (allowZero ? 0 : 1)) {
    throw new EndpointPolicyError("invalid_url", `${name} must be a ${allowZero ? "non-negative" : "positive"} integer`);
  }
  return resolved;
}

function normalizePolicy(policy: EndpointPolicyOptions): NormalizedEndpointPolicy {
  const protocols = policy.allowedProtocols ?? ["http:", "https:"];
  if (protocols.length === 0 || protocols.some((protocol) => protocol !== "http:" && protocol !== "https:")) {
    throw new EndpointPolicyError("invalid_url", "endpoint protocol policy is invalid");
  }
  const ports = policy.allowedPorts?.map((port) => positiveInteger(port, port, "endpoint port"));
  if (ports?.some((port) => port > 65_535)) {
    throw new EndpointPolicyError("invalid_url", "endpoint port policy is invalid");
  }
  const requestContentTypes = policy.allowedRequestContentTypes?.map((value) => value.trim().toLowerCase());
  const responseContentTypes = policy.allowedResponseContentTypes?.map((value) => value.trim().toLowerCase());
  if ([requestContentTypes, responseContentTypes].some((values) => values?.some((value) => !value || value.includes(";")))) {
    throw new EndpointPolicyError("invalid_url", "endpoint content-type policy is invalid");
  }
  return Object.freeze({
    allowPrivateNetwork: policy.allowPrivateNetwork,
    allowedPorts: ports ? new Set(ports) : undefined,
    allowedProtocols: new Set(protocols),
    allowedRequestContentTypes: requestContentTypes,
    allowedResponseContentTypes: responseContentTypes,
    maxRedirects: positiveInteger(policy.maxRedirects, DEFAULT_MAX_REDIRECTS, "endpoint redirect limit", true),
    maxRequestBodyBytes: policy.maxRequestBodyBytes === undefined
      ? undefined
      : positiveInteger(policy.maxRequestBodyBytes, policy.maxRequestBodyBytes, "endpoint request body limit", true),
    maxResponseBodyBytes: positiveInteger(policy.maxResponseBodyBytes, LLM_RESPONSE_BODY_MAX_BYTES - 1, "endpoint response body limit", true),
    rejectEncodedResponses: policy.rejectEncodedResponses ?? false,
    rejectFragments: policy.rejectFragments ?? false,
    rejectIpLiterals: policy.rejectIpLiterals ?? false,
    rejectTrailingDot: policy.rejectTrailingDot ?? false,
    requireDnsHostname: policy.requireDnsHostname ?? false,
    timeoutMs: positiveInteger(policy.timeoutMs, DEFAULT_TIMEOUT_MS, "endpoint timeout"),
  });
}

function normalizeHostname(hostname: string): string {
  const unbracketed = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  const normalized = unbracketed.toLowerCase().replace(/\.+$/, "");
  if (!normalized) throw new EndpointPolicyError("invalid_url", "endpoint host is invalid");
  return normalized;
}

function effectivePort(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

function parseEndpointUrl(endpoint: string, policy: NormalizedEndpointPolicy): URL {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new EndpointPolicyError("invalid_url", "endpoint must be a valid URL");
  }
  if (!policy.allowedProtocols.has(parsed.protocol as "http:" | "https:") || parsed.username || parsed.password) {
    throw new EndpointPolicyError("invalid_url", "endpoint URL is not allowed");
  }
  if (policy.rejectFragments && parsed.hash) {
    throw new EndpointPolicyError("invalid_url", "endpoint URL fragment is not allowed");
  }
  if (policy.rejectTrailingDot && parsed.hostname.endsWith(".")) {
    throw new EndpointPolicyError("invalid_url", "endpoint host trailing dot is not allowed");
  }
  const hostname = normalizeHostname(parsed.hostname);
  const literal = isIP(hostname) !== 0;
  if ((policy.rejectIpLiterals || policy.requireDnsHostname) && literal) {
    throw new EndpointPolicyError("invalid_url", "endpoint host must be a DNS name");
  }
  if (policy.requireDnsHostname && (hostname === "localhost" || hostname.endsWith(".localhost"))) {
    throw new EndpointPolicyError("invalid_url", "endpoint host must be a public DNS name");
  }
  if (policy.allowedPorts && !policy.allowedPorts.has(effectivePort(parsed))) {
    throw new EndpointPolicyError("invalid_url", "endpoint port is not allowed");
  }
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
    || tailParts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  const missing = 8 - headParts.length - tailParts.length;
  if ((compression === -1 && missing !== 0) || (compression !== -1 && missing < 1)) return undefined;
  const parts = [...headParts, ...Array<string>(Math.max(0, missing)).fill("0"), ...tailParts];
  if (parts.length !== 8) return undefined;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < parts.length; index += 1) {
    const part = Number.parseInt(parts[index]!, 16);
    bytes[index * 2] = part >>> 8;
    bytes[index * 2 + 1] = part & 0xff;
  }
  return bytes;
}

interface Ipv6Prefix {
  readonly bytes: readonly number[];
  readonly bitLength: number;
}

function matchesIpv6Prefix(bytes: Uint8Array, prefix: Ipv6Prefix): boolean {
  const completeBytes = Math.floor(prefix.bitLength / 8);
  for (let index = 0; index < completeBytes; index += 1) {
    if (bytes[index] !== prefix.bytes[index]) return false;
  }
  const remainingBits = prefix.bitLength % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[completeBytes]! & mask) === (prefix.bytes[completeBytes]! & mask);
}

const IPV6_GLOBAL_UNICAST: Ipv6Prefix = { bytes: [0x20], bitLength: 3 };
const IPV6_SPECIAL_PURPOSE_GLOBAL_UNICAST: readonly Ipv6Prefix[] = [
  { bytes: [0x20, 0x01, 0x00], bitLength: 23 },
  { bytes: [0x20, 0x01, 0x0d, 0xb8], bitLength: 32 },
  { bytes: [0x20, 0x02], bitLength: 16 },
  { bytes: [0x26, 0x20, 0x00, 0x4f, 0x80, 0x00], bitLength: 48 },
  { bytes: [0x3f, 0xff, 0x00], bitLength: 20 },
];

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
  const ipv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  const ipv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (ipv4Compatible || ipv4Mapped) {
    return isPrivateIPv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  // Fail closed outside today's global-unicast allocation, then remove every
  // IANA special-purpose block embedded within 2000::/3.
  return !matchesIpv6Prefix(bytes, IPV6_GLOBAL_UNICAST)
    || IPV6_SPECIAL_PURPOSE_GLOBAL_UNICAST.some((prefix) => matchesIpv6Prefix(bytes, prefix));
}

export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const addressType = isIP(normalized);
  if (addressType === 4) return isPrivateIPv4(normalized);
  if (addressType === 6) return isPrivateIPv6(normalized);
  return false;
}

function abortError(signal: AbortSignal, timeoutSignal: AbortSignal): EndpointPolicyError {
  if (timeoutSignal.aborted) return new EndpointPolicyError("timeout", "endpoint request timed out");
  return new EndpointPolicyError("aborted", "endpoint request was aborted", signal.reason instanceof Error ? { cause: signal.reason } : undefined);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal, timeoutSignal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal, timeoutSignal));
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(abortError(signal, timeoutSignal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

async function resolveEndpoint(
  endpoint: string,
  policy: NormalizedEndpointPolicy,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<PinnedEndpoint> {
  const url = parseEndpointUrl(endpoint, policy);
  const hostname = normalizeHostname(url.hostname);
  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await abortable(dns.lookup(hostname, { all: true, verbatim: true }), signal, timeoutSignal);
  } catch (error) {
    if (error instanceof EndpointPolicyError) throw error;
    throw new EndpointPolicyError("dns", "endpoint host could not be resolved", { cause: error });
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new EndpointPolicyError("dns", "endpoint host could not be resolved");
  }
  let privateAddress = hostname === "localhost" || hostname.endsWith(".localhost");
  const addresses: PinnedAddress[] = [];
  for (const answer of answers) {
    const address = normalizeHostname(answer.address);
    const family = isIP(address);
    if ((family !== 4 && family !== 6) || answer.family !== family) {
      throw new EndpointPolicyError("dns", "endpoint host returned an invalid address");
    }
    privateAddress ||= isPrivateAddress(address);
    addresses.push(Object.freeze({ address, family }));
  }
  if (!policy.allowPrivateNetwork && privateAddress) {
    throw new EndpointPolicyError("private_address", "endpoint points to a non-global network address");
  }
  return Object.freeze({ url, hostname, addresses: Object.freeze(addresses) });
}

export async function validateEndpointUrl(endpoint: string, allowPrivate: boolean): Promise<void> {
  const policy = normalizePolicy({ allowPrivateNetwork: allowPrivate });
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  await resolveEndpoint(endpoint, policy, timeoutSignal, timeoutSignal);
}

function logicalHostHeader(url: URL, hostname: string): string {
  const host = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return url.port ? `${host}:${url.port}` : host;
}

function originKey(url: URL): string {
  const hostname = normalizeHostname(url.hostname);
  return `${url.protocol}//${isIP(hostname) === 6 ? `[${hostname}]` : hostname}:${effectivePort(url)}`;
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
  for (const name of [...headers.keys()]) if (isCrossOriginCredentialHeader(name)) headers.delete(name);
}

function stripBodyHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    if (name.startsWith("content-") || name === "transfer-encoding") headers.delete(name);
  }
}

function prepareHeaders(init: RequestInit, body?: Buffer): Headers {
  const headers = new Headers(init.headers);
  if (headers.has("host")) throw new EndpointPolicyError("invalid_url", "caller-supplied Host header is not allowed");
  headers.delete("transfer-encoding");
  headers.delete("content-length");
  if (body) headers.set("content-length", String(body.length));
  return headers;
}

function enforceRequestBodyLimit(byteLength: number, maxBytes: number | undefined): void {
  if (maxBytes !== undefined && byteLength > maxBytes) {
    throw new EndpointPolicyError("request_too_large", "endpoint request body exceeds the allowed size");
  }
}

async function prepareBody(body: RequestInit["body"], maxBytes: number | undefined): Promise<Buffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    enforceRequestBodyLimit(Buffer.byteLength(body), maxBytes);
    return Buffer.from(body);
  }
  if (body instanceof URLSearchParams) {
    const value = body.toString();
    enforceRequestBodyLimit(Buffer.byteLength(value), maxBytes);
    return Buffer.from(value);
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    enforceRequestBodyLimit(body.size, maxBytes);
    return Buffer.from(await body.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) {
    enforceRequestBodyLimit(body.byteLength, maxBytes);
    return Buffer.from(body.slice(0));
  }
  if (ArrayBuffer.isView(body)) {
    enforceRequestBodyLimit(body.byteLength, maxBytes);
    return Buffer.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  throw new EndpointPolicyError("request_too_large", "endpoint request body must be replayable");
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
        throw new EndpointPolicyError("dns", "endpoint transport requested an unexpected hostname");
      }
      const address = endpoint.addresses[0];
      if (!address) throw new EndpointPolicyError("dns", "endpoint host could not be resolved");
      if (options.all) {
        callback(null, endpoint.addresses.map((pinned) => ({ address: pinned.address, family: pinned.family })));
      } else callback(null, address.address, address.family);
    } catch (error) {
      callback(error as NodeJS.ErrnoException, "", 0);
    }
  };
}

function responseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.append(name, value);
  }
  return headers;
}

function requestPinnedEndpoint(
  endpoint: PinnedEndpoint,
  request: PreparedRequest,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<TransportResponse> {
  return new Promise<TransportResponse>((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal, timeoutSignal)); return; }
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
      ...(endpoint.url.protocol === "https:" ? { servername: endpoint.hostname } : {}),
    };
    const issueRequest = endpoint.url.protocol === "https:" ? httpsRequest : httpRequest;
    let clientRequest: ReturnType<typeof httpRequest> | undefined;
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const finish = (callback: () => void, retainAbort = false): void => {
      if (settled) return;
      settled = true;
      if (!retainAbort) cleanup();
      callback();
    };
    const abort = (): void => {
      const reason = abortError(signal, timeoutSignal);
      clientRequest?.destroy(reason);
      finish(() => reject(reason));
    };
    clientRequest = issueRequest(options, (response) => {
      finish(() => resolve({ response, status: response.statusCode ?? 0, cleanup }), true);
    });
    clientRequest.once("error", (error) => finish(() => reject(error)));
    if (!settled) signal.addEventListener("abort", abort, { once: true });
    clientRequest.end(request.body);
  });
}

function cancelResponse(response: IncomingMessage): void {
  response.destroy();
  response.socket?.destroy();
}

function declaredResponseBodyExceedsLimit(response: IncomingMessage, limit: number): boolean {
  const header = response.headers["content-length"];
  if (typeof header !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(header)) return false;
  const length = Number(header);
  return !Number.isSafeInteger(length) || length > limit;
}

function contentTypeAllowed(response: IncomingMessage, allowed: readonly string[]): boolean {
  const header = response.headers["content-type"];
  if (typeof header !== "string") return false;
  const actual = header.split(";", 1)[0]!.trim().toLowerCase();
  return allowed.some((candidate) => candidate === actual
    || (candidate === "application/*+json" && actual.startsWith("application/") && actual.endsWith("+json")));
}

function requestContentTypeAllowed(headers: Headers, allowed: readonly string[]): boolean {
  const header = headers.get("content-type");
  if (!header) return false;
  const actual = header.split(";", 1)[0]!.trim().toLowerCase();
  return allowed.includes(actual);
}

function validateResponseHeaders(response: IncomingMessage, policy: NormalizedEndpointPolicy): void {
  const encoding = response.headers["content-encoding"];
  if (policy.rejectEncodedResponses && encoding !== undefined
    && (typeof encoding !== "string" || encoding.trim().toLowerCase() !== "identity")) {
    throw new EndpointPolicyError("content_encoding", "endpoint response encoding is not allowed");
  }
  if (policy.allowedResponseContentTypes && !contentTypeAllowed(response, policy.allowedResponseContentTypes)) {
    throw new EndpointPolicyError("content_type", "endpoint response content type is not allowed");
  }
}

function readResponse(
  response: IncomingMessage,
  policy: NormalizedEndpointPolicy,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    try {
      validateResponseHeaders(response, policy);
      if (declaredResponseBodyExceedsLimit(response, policy.maxResponseBodyBytes)) {
        throw new EndpointPolicyError("response_too_large", "endpoint response body exceeds the allowed size");
      }
    } catch (error) {
      cancelResponse(response);
      reject(error);
      return;
    }
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
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
    const onAbort = (): void => { fail(abortError(signal, timeoutSignal)); cancelResponse(response); };
    const onData = (chunk: Buffer | Uint8Array | string): void => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
      if (bytes.byteLength > policy.maxResponseBodyBytes - byteLength) {
        fail(new EndpointPolicyError("response_too_large", "endpoint response body exceeds the allowed size"));
        cancelResponse(response);
        return;
      }
      chunks.push(bytes);
      byteLength += bytes.byteLength;
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const body = Buffer.concat(chunks, byteLength);
      resolve(new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)));
    };
    const onError = (error: Error): void => fail(error);
    const onAborted = (): void => fail(new EndpointPolicyError("network", "endpoint response was aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    response.on("data", onData);
    response.once("end", onEnd);
    response.once("error", onError);
    response.once("aborted", onAborted);
    response.resume();
  });
}

function redirectRequest(status: number, request: PreparedRequest, previousUrl: URL, nextUrl: URL): PreparedRequest {
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

export async function safeEndpointFetch(url: string, init: RequestInit, options: EndpointPolicyOptions): Promise<Response> {
  const policy = normalizePolicy(options);
  const timeoutSignal = AbortSignal.timeout(policy.timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  try {
    const body = await abortable(prepareBody(init.body, policy.maxRequestBodyBytes), signal, timeoutSignal);
    const method = (init.method ?? "GET").toUpperCase();
    if (!/^[A-Z]+$/.test(method)) throw new EndpointPolicyError("invalid_url", "endpoint request method is invalid");
    if ((method === "GET" || method === "HEAD") && body) {
      throw new EndpointPolicyError("invalid_url", "endpoint GET and HEAD requests cannot include a body");
    }
    let currentUrl = parseEndpointUrl(url, policy);
    let request: PreparedRequest = { method, body, headers: prepareHeaders(init, body) };
    if (body && policy.allowedRequestContentTypes && !requestContentTypeAllowed(request.headers, policy.allowedRequestContentTypes)) {
      throw new EndpointPolicyError("content_type", "endpoint request content type is not allowed");
    }
    for (let redirects = 0; ; redirects += 1) {
      const endpoint = await resolveEndpoint(currentUrl.toString(), policy, signal, timeoutSignal);
      const transport = await requestPinnedEndpoint(endpoint, request, signal, timeoutSignal);
      const location = transport.response.headers.location;
      if (REDIRECT_STATUSES.has(transport.status) && location) {
        cancelResponse(transport.response);
        transport.cleanup();
        if (redirects >= policy.maxRedirects) {
          throw new EndpointPolicyError("redirect", "endpoint redirect is not allowed");
        }
        let nextUrl: URL;
        try {
          nextUrl = parseEndpointUrl(new URL(location, currentUrl).toString(), policy);
        } catch (error) {
          if (error instanceof EndpointPolicyError) throw error;
          throw new EndpointPolicyError("redirect", "endpoint redirect location is invalid", { cause: error });
        }
        request = redirectRequest(transport.status, request, currentUrl, nextUrl);
        currentUrl = nextUrl;
        continue;
      }
      try {
        if (transport.status < 100 || transport.status > 599) {
          cancelResponse(transport.response);
          throw new EndpointPolicyError("invalid_response", "endpoint returned an invalid status");
        }
        const responseBody = await readResponse(transport.response, policy, signal, timeoutSignal);
        const bodyAllowed = request.method !== "HEAD" && transport.status !== 204 && transport.status !== 205 && transport.status !== 304;
        return new Response(bodyAllowed ? responseBody : null, {
          status: transport.status,
          statusText: transport.response.statusMessage,
          headers: responseHeaders(transport.response),
        });
      } finally {
        transport.cleanup();
      }
    }
  } catch (error) {
    if (error instanceof EndpointPolicyError) throw error;
    if (signal.aborted) throw abortError(signal, timeoutSignal);
    throw new EndpointPolicyError("network", "endpoint request failed", { cause: error });
  }
}

export function safeLlmFetch(url: string, init: RequestInit, policy: EndpointPolicyOptions): Promise<Response> {
  return safeEndpointFetch(url, init, {
    maxRedirects: DEFAULT_MAX_REDIRECTS,
    maxResponseBodyBytes: LLM_RESPONSE_BODY_MAX_BYTES - 1,
    ...policy,
  });
}
