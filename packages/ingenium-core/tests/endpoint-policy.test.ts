import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as dns } from "node:dns";
import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

const httpsRequestMock = vi.hoisted(() => vi.fn());

vi.mock("node:https", () => ({ request: httpsRequestMock }));

import {
  isPrivateAddress,
  LLM_RESPONSE_BODY_MAX_BYTES,
  safeEndpointFetch,
  safeLlmFetch,
  validateEndpointUrl,
} from "../lib/tools/endpoint-policy.js";

interface CapturedRequest {
  readonly method: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

let originServer: Server;
let targetServer: Server;
let bodyServer: Server;
let originPort: number;
let targetPort: number;
let bodyPort: number;
let targetRequests: CapturedRequest[] = [];
let loopRequests = 0;
let oversizedChunksSent = 0;
let contentLengthBodyWrites = 0;

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let complete: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: () => complete?.() };
}

let oversizedDelivery = deferred();
let contentLengthDelivery = deferred();
let slowSocketClosed = deferred();

function lookupToLoopback(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(dns, "lookup").mockImplementation(async () => ([
    { address: "127.0.0.1", family: 4 },
  ] as never));
}

async function readRequest(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

beforeAll(async () => {
  originServer = createServer(async (request, response) => {
    if (request.url === "/pin") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("pinned");
      return;
    }

    if (request.url === "/json") {
      response.writeHead(200, { "Content-Type": "application/problem+json; charset=utf-8" });
      response.end(JSON.stringify({ encoding: request.headers["accept-encoding"] }));
      return;
    }

    if (request.url === "/compressed") {
      response.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
      response.end("not-really-compressed");
      return;
    }

    if (request.url === "/no-content-type") {
      response.writeHead(200);
      response.end("{}");
      return;
    }

    if (request.url === "/loop") {
      loopRequests += 1;
      response.writeHead(302, { Location: "/loop" });
      response.end("redirect");
      return;
    }

    const redirect = request.url?.match(/^\/redirect-(301|302|303|307|308)$/);
    if (redirect) {
      response.writeHead(Number(redirect[1]), { Location: `http://target.test:${targetPort}/capture-${redirect[1]}` });
      response.end("redirect");
      return;
    }

    if (request.url === "/redirect-300") {
      response.writeHead(300, { Location: `http://target.test:${targetPort}/capture-300` });
      response.end("not followed");
      return;
    }

    response.writeHead(302, { Location: `http://target.test:${targetPort}/capture-post` });
    response.end("redirect");
  });
  targetServer = createServer(async (request, response) => {
    targetRequests.push({
      method: request.method ?? "",
      headers: request.headers,
      body: await readRequest(request),
    });
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
  });
  bodyServer = createServer((request, response) => {
    if (request.url === "/below-limit") {
      const payload = Buffer.alloc(LLM_RESPONSE_BODY_MAX_BYTES - 1, 0xa5);
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.write(payload.subarray(0, 17));
      response.write(payload.subarray(17, 65_537));
      response.end(payload.subarray(65_537));
      return;
    }

    if (request.url === "/at-limit") {
      const delivery = oversizedDelivery;
      let closed = false;
      response.once("close", () => {
        closed = true;
      });
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      oversizedChunksSent += 1;
      response.write(Buffer.alloc(LLM_RESPONSE_BODY_MAX_BYTES - 1, 0xa5));
      setTimeout(() => {
        if (!closed) {
          oversizedChunksSent += 1;
          response.write(Buffer.from([0x5a]));
        }
        setTimeout(() => {
          if (!closed) {
            oversizedChunksSent += 1;
            response.end(Buffer.alloc(64, 0x3c));
          }
          delivery.resolve();
        }, 10);
      }, 10);
      return;
    }

    if (request.url === "/content-length-over-limit") {
      const delivery = contentLengthDelivery;
      let closed = false;
      response.once("close", () => {
        closed = true;
      });
      response.writeHead(200, {
        "Content-Length": String(LLM_RESPONSE_BODY_MAX_BYTES + 1),
      });
      response.flushHeaders();
      setTimeout(() => {
        if (!closed) {
          contentLengthBodyWrites += 1;
          response.end("late body");
        }
        delivery.resolve();
      }, 20);
      return;
    }

    if (request.url === "/slow") {
      const delivery = slowSocketClosed;
      request.socket.once("close", () => delivery.resolve());
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("partial");
      return;
    }

    if (request.url === "/slow-headers") {
      setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end("{}");
        }
      }, 100);
      return;
    }

    response.writeHead(404);
    response.end();
  });
  targetPort = await listen(targetServer);
  originPort = await listen(originServer);
  bodyPort = await listen(bodyServer);
});

afterAll(async () => {
  await Promise.all([close(originServer), close(targetServer), close(bodyServer)]);
});

beforeEach(() => {
  oversizedChunksSent = 0;
  contentLengthBodyWrites = 0;
  oversizedDelivery = deferred();
  contentLengthDelivery = deferred();
  slowSocketClosed = deferred();
});

afterEach(() => {
  targetRequests = [];
  loopRequests = 0;
  httpsRequestMock.mockReset();
  vi.restoreAllMocks();
});

describe("endpoint policy address validation", () => {
  it("fails closed when one DNS answer is private even when another is public", async () => {
    const lookup = vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ] as never);

    await expect(validateEndpointUrl("https://mixed.test/v1", false))
      .rejects.toThrow("non-global");
    expect(lookup).toHaveBeenCalledWith("mixed.test", { all: true, verbatim: true });
  });

  it("rejects IPv4-mapped and IPv6 special addresses", async () => {
    expect(isPrivateAddress("[::1]")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.1.5")).toBe(true);
    expect(isPrivateAddress("2001:db8::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);

    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "::ffff:127.0.0.1", family: 6 },
    ] as never);
    await expect(validateEndpointUrl("http://[::ffff:127.0.0.1]/", false))
      .rejects.toThrow("non-global");
  });

  it.each([
    ["translation", "64:ff9b::", "64:ff9b::ffff:ffff"],
    ["local translation", "64:ff9b:1::", "64:ff9b:1:ffff:ffff:ffff:ffff:ffff"],
    ["discard-only", "100::", "100::ffff:ffff:ffff:ffff"],
    ["dummy", "100:0:0:1::", "100:0:0:1:ffff:ffff:ffff:ffff"],
    ["IETF assignments", "2001::", "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["documentation", "2001:db8::", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["6to4", "2002::", "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["AS112", "2620:4f:8000::", "2620:4f:8000:ffff:ffff:ffff:ffff:ffff"],
    ["new documentation", "3fff::", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["future-use", "4000::", "5fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["segment routing", "5f00::", "5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["unique-local", "fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["link-local", "fe80::", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["site-local", "fec0::", "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
    ["multicast", "ff00::", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
  ])("rejects both boundaries of the %s IPv6 block", (_name, first, last) => {
    expect(isPrivateAddress(first)).toBe(true);
    expect(isPrivateAddress(last)).toBe(true);
  });

  it.each([
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "2a00:1450:4009:80b::200e",
  ])("allows ordinary public global-unicast address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it.each([
    "2001:200::1",
    "2001:db7:ffff::1",
    "2001:db9::1",
    "2003::1",
    "2620:4f:7fff:ffff::1",
    "2620:4f:8001::1",
    "3ffe:ffff::1",
    "3fff:1000::1",
    "3fff:ffff::1",
  ])("does not overmatch adjacent global-unicast address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("fails closed when public and reserved IPv6 answers are mixed", async () => {
    const lookup = vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "100:0:0:1::1", family: 6 },
    ] as never);

    await expect(validateEndpointUrl("https://mixed-v6.test/v1", false))
      .rejects.toThrow("non-global");
    expect(lookup).toHaveBeenCalledWith("mixed-v6.test", { all: true, verbatim: true });
  });

  it("pins a single DNS resolution rather than rebinding during transport", async () => {
    const lookup = lookupToLoopback();
    const response = await safeLlmFetch(`http://rebind.test:${originPort}/pin`, {}, {
      allowPrivateNetwork: true,
    });

    expect(await response.text()).toBe("pinned");
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("rejects caller-controlled Host headers", async () => {
    await expect(safeLlmFetch("http://host.test/", {
      headers: { Host: "attacker.test" },
    }, { allowPrivateNetwork: true })).rejects.toThrow("Host header");
  });
});

describe("endpoint policy pinned transport", () => {
  it("preserves the normalized logical Host and TLS SNI while using the pinned peer", async () => {
    const lookup = vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    let options: Record<string, unknown> | undefined;
    let pinnedAddress: string | undefined;

    httpsRequestMock.mockImplementation((requestOptions: Record<string, unknown>, callback: (response: IncomingMessage) => void) => {
      options = requestOptions;
      (requestOptions.lookup as (
        host: string,
        lookupOptions: unknown,
        done: (error: Error | null, address: string) => void,
      ) => void)("logical.test", {}, (error, address) => {
        expect(error).toBeNull();
        pinnedAddress = address;
      });
      const request = new EventEmitter() as EventEmitter & {
        end(): void;
        destroy(error?: Error): void;
      };
      request.end = () => {
        const response = Object.assign(Readable.from([Buffer.from("secure")]), {
          statusCode: 200,
          statusMessage: "OK",
          headers: {},
        }) as IncomingMessage;
        queueMicrotask(() => callback(response));
      };
      request.destroy = (error?: Error) => {
        if (error) request.emit("error", error);
      };
      return request;
    });

    const response = await safeLlmFetch("https://logical.test./v1", {}, { allowPrivateNetwork: false });

    expect(await response.text()).toBe("secure");
    expect(lookup).toHaveBeenCalledWith("logical.test", { all: true, verbatim: true });
    expect(options).toMatchObject({
      hostname: "logical.test",
      servername: "logical.test",
      headers: { host: "logical.test" },
    });
    expect(pinnedAddress).toBe("93.184.216.34");
  });
});

describe("endpoint policy redirects", () => {
  it("strips cross-origin credentials and converts POST to GET for 302", async () => {
    lookupToLoopback();
    const response = await safeLlmFetch(`http://origin.test:${originPort}/redirect-302`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Proxy-Authorization": "Basic proxy-secret",
        Cookie: "session=secret",
        Cookie2: "legacy=secret",
        "Content-Authorization": "content-secret",
        "Content-Token": "token-secret",
        "Content-Type": "application/json",
      },
      body: "payload",
    }, { allowPrivateNetwork: true });

    expect(await response.text()).toBe("ok");
    expect(targetRequests).toEqual([expect.objectContaining({ method: "GET", body: "" })]);
    const target = targetRequests[0]!;
    expect(target.headers.authorization).toBeUndefined();
    expect(target.headers["proxy-authorization"]).toBeUndefined();
    expect(target.headers.cookie).toBeUndefined();
    expect(target.headers.cookie2).toBeUndefined();
    expect(target.headers["content-authorization"]).toBeUndefined();
    expect(target.headers["content-token"]).toBeUndefined();
    expect(target.headers["content-type"]).toBeUndefined();
  });

  it.each([301, 303])("converts POST to GET for %i", async (status) => {
    lookupToLoopback();
    const response = await safeLlmFetch(`http://origin.test:${originPort}/redirect-${status}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "discard-me",
    }, { allowPrivateNetwork: true });

    expect(await response.text()).toBe("ok");
    expect(targetRequests).toEqual([expect.objectContaining({ method: "GET", body: "" })]);
  });

  it.each([307, 308])("preserves a replayable POST body for %i while stripping cross-origin credentials", async (status) => {
    lookupToLoopback();
    const response = await safeLlmFetch(`http://origin.test:${originPort}/redirect-${status}`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "text/plain" },
      body: "replay-me",
    }, { allowPrivateNetwork: true });

    expect(await response.text()).toBe("ok");
    expect(targetRequests).toEqual([expect.objectContaining({ method: "POST", body: "replay-me" })]);
    expect(targetRequests[0]!.headers.authorization).toBeUndefined();
    expect(targetRequests[0]!.headers["content-type"]).toBe("text/plain");
  });

  it("does not follow non-allowlisted redirects", async () => {
    lookupToLoopback();
    const response = await safeLlmFetch(`http://origin.test:${originPort}/redirect-300`, {}, {
      allowPrivateNetwork: true,
    });
    expect(response.status).toBe(300);
    expect(await response.text()).toBe("not followed");
    expect(targetRequests).toHaveLength(0);
  });

  it("drains allowed redirect responses and enforces the redirect limit", async () => {
    lookupToLoopback();
    await expect(safeLlmFetch(`http://origin.test:${originPort}/loop`, {}, {
      allowPrivateNetwork: true,
    })).rejects.toThrow("redirect");
    expect(loopRequests).toBeGreaterThan(10);
  });

  it("rejects streaming redirect bodies before transport", async () => {
    await expect(safeLlmFetch("http://stream.test/", {
      method: "POST",
      body: Readable.from(["not replayable"]) as unknown as BodyInit,
    }, { allowPrivateNetwork: true })).rejects.toThrow("replayable");
  });
});

describe("generalized endpoint policy bounds", () => {
  it.each([
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
    "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:10.0.0.1", "64:ff9b:1::1", "100::1", "2001:db8::1",
    "2002::1", "fc00::1", "fe80::1", "fec0::1", "ff00::1",
  ])("classifies %s as non-global", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it("enforces protocol, port, DNS-name, fragment, and trailing-dot policy before transport", async () => {
    const policy = {
      allowPrivateNetwork: false,
      allowedPorts: [443],
      allowedProtocols: ["https:" as const],
      rejectFragments: true,
      rejectIpLiterals: true,
      rejectTrailingDot: true,
      requireDnsHostname: true,
    };
    await expect(safeEndpointFetch("http://public.example/v1", {}, policy)).rejects.toMatchObject({ code: "invalid_url" });
    await expect(safeEndpointFetch("https://public.example:8443/v1", {}, policy)).rejects.toMatchObject({ code: "invalid_url" });
    await expect(safeEndpointFetch("https://127.0.0.1/v1", {}, policy)).rejects.toMatchObject({ code: "invalid_url" });
    await expect(safeEndpointFetch("https://localhost/v1", {}, policy)).rejects.toMatchObject({ code: "invalid_url" });
    await expect(safeEndpointFetch("https://public.example./v1", {}, policy)).rejects.toMatchObject({ code: "invalid_url" });
    await expect(safeEndpointFetch("https://public.example/v1#fragment", {}, policy)).rejects.toMatchObject({ code: "invalid_url" });
    await expect(safeEndpointFetch("https://user:pass@public.example/v1", {}, policy)).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("enforces request bytes, JSON-compatible content, identity encoding, and zero redirects", async () => {
    lookupToLoopback();
    await expect(safeEndpointFetch(`http://origin.test:${originPort}/pin`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "12345",
    }, { allowPrivateNetwork: true, maxRequestBodyBytes: 4 })).rejects.toMatchObject({ code: "request_too_large" });
    const oversizedBlob = new Blob(["12345"]);
    const bodyRead = vi.spyOn(oversizedBlob, "arrayBuffer");
    await expect(safeEndpointFetch(`http://origin.test:${originPort}/pin`, {
      method: "POST",
      body: oversizedBlob,
    }, { allowPrivateNetwork: true, maxRequestBodyBytes: 4 })).rejects.toMatchObject({ code: "request_too_large" });
    expect(bodyRead).not.toHaveBeenCalled();
    await expect(safeEndpointFetch(`http://origin.test:${originPort}/pin`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "ok",
    }, {
      allowPrivateNetwork: true,
      allowedRequestContentTypes: ["application/x-www-form-urlencoded"],
    })).rejects.toMatchObject({ code: "content_type" });

    const response = await safeEndpointFetch(`http://origin.test:${originPort}/json`, {
      headers: { "accept-encoding": "identity" },
    }, {
      allowPrivateNetwork: true,
      allowedResponseContentTypes: ["application/json", "application/*+json"],
      rejectEncodedResponses: true,
    });
    expect(await response.json()).toEqual({ encoding: "identity" });

    await expect(safeEndpointFetch(`http://origin.test:${originPort}/pin`, {}, {
      allowPrivateNetwork: true,
      allowedResponseContentTypes: ["application/json"],
    })).rejects.toMatchObject({ code: "content_type" });
    await expect(safeEndpointFetch(`http://origin.test:${originPort}/no-content-type`, {}, {
      allowPrivateNetwork: true,
      allowedResponseContentTypes: ["application/json"],
    })).rejects.toMatchObject({ code: "content_type" });
    await expect(safeEndpointFetch(`http://origin.test:${originPort}/compressed`, {}, {
      allowPrivateNetwork: true,
      allowedResponseContentTypes: ["application/json"],
      rejectEncodedResponses: true,
    })).rejects.toMatchObject({ code: "content_encoding" });
    await expect(safeEndpointFetch(`http://origin.test:${originPort}/redirect-302`, {}, {
      allowPrivateNetwork: true,
      maxRedirects: 0,
    })).rejects.toMatchObject({ code: "redirect" });
  });

  it("honors caller abort and ignores proxy environment variables", async () => {
    lookupToLoopback();
    const originalProxy = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = "http://127.0.0.1:1";
    try {
      const direct = await safeEndpointFetch(`http://origin.test:${originPort}/pin`, {}, { allowPrivateNetwork: true });
      expect(await direct.text()).toBe("pinned");
      const controller = new AbortController();
      const pending = safeEndpointFetch(`http://body.test:${bodyPort}/slow`, { signal: controller.signal }, {
        allowPrivateNetwork: true,
        timeoutMs: 5_000,
      });
      setTimeout(() => controller.abort(), 20);
      await expect(pending).rejects.toMatchObject({ code: "aborted" });
    } finally {
      if (originalProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = originalProxy;
    }
  });

  it("applies one timeout to slow headers and slow response bodies", async () => {
    lookupToLoopback();
    await expect(safeEndpointFetch(`http://body.test:${bodyPort}/slow-headers`, {}, {
      allowPrivateNetwork: true,
      timeoutMs: 20,
    })).rejects.toMatchObject({ code: "timeout" });
    await expect(safeEndpointFetch(`http://body.test:${bodyPort}/slow`, {}, {
      allowPrivateNetwork: true,
      timeoutMs: 20,
    })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("endpoint policy response body limit", () => {
  it("preserves chunked bytes just below the response limit", async () => {
    lookupToLoopback();
    const response = await safeLlmFetch(`http://body.test:${bodyPort}/below-limit`, {}, {
      allowPrivateNetwork: true,
    });

    expect(Buffer.from(await response.arrayBuffer()).equals(
      Buffer.alloc(LLM_RESPONSE_BODY_MAX_BYTES - 1, 0xa5),
    )).toBe(true);
  });

  it("cancels at the byte limit before later chunks are sent", async () => {
    lookupToLoopback();
    await expect(safeLlmFetch(`http://body.test:${bodyPort}/at-limit`, {}, {
      allowPrivateNetwork: true,
    })).rejects.toThrow("endpoint response body exceeds the allowed size");

    await oversizedDelivery.promise;
    expect(oversizedChunksSent).toBe(2);
  });

  it("rejects an oversized content-length before reading a body chunk", async () => {
    lookupToLoopback();
    await expect(safeLlmFetch(`http://body.test:${bodyPort}/content-length-over-limit`, {}, {
      allowPrivateNetwork: true,
    })).rejects.toThrow("endpoint response body exceeds the allowed size");

    await contentLengthDelivery.promise;
    expect(contentLengthBodyWrites).toBe(0);
  });

  it("keeps the transport abort listener active until a timed-out response is closed", async () => {
    lookupToLoopback();
    await expect(safeLlmFetch(`http://body.test:${bodyPort}/slow`, {}, {
      allowPrivateNetwork: true,
      timeoutMs: 50,
    })).rejects.toBeInstanceOf(Error);
    await slowSocketClosed.promise;
  });
});
