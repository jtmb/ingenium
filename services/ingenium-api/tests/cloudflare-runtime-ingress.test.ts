import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudflareTunnel } from "ingenium-core";
import { cloudflareIngressForHost, cloudflareLauncherOriginAllowed } from "../lib/cloudflare-trusted-ingress.js";
import { handleRuntimeGatewayRequest, proxyResponseHeaders, runtimeScope } from "../scripts/runtime-gateway.js";

const runtimeId = "11111111-1111-4111-8111-111111111111";
const otherRuntimeId = "22222222-2222-4222-8222-222222222222";
const token = `rbs_${"a".repeat(43)}`;
const mappings = [["opencode", "web"], ["cli", "cli"], ["vscode", "vscode"]] as const;
let directory: string;
let server: Server;
const validate = vi.fn();

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "cloudflare-runtime-ingress-"));
  const inventory = {
    tunnelName: "production",
    routes: Object.fromEntries(cloudflareTunnel.CLOUDFLARE_SERVICE_IDS.map((service) => [service, [{
      publicUrl: `https://${service}.example.com/`,
      target: cloudflareTunnel.CLOUDFLARE_SERVICE_TARGETS[service],
    }]])),
  };
  writeFileSync(join(directory, "routes.json"), JSON.stringify(inventory), { mode: 0o600 });
  writeFileSync(join(directory, "gateway-token"), "g".repeat(43), { mode: 0o600 });
  vi.stubEnv("INGENIUM_CLOUDFLARE_ROUTES_FILE", join(directory, "routes.json"));
  vi.stubEnv("INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE", join(directory, "gateway-token"));
  vi.stubEnv("INGENIUM_RUNTIME_API_URL", "http://api.internal/api/v1/");
  vi.stubEnv("INGENIUM_RUNTIME_ROOT_DOMAIN", "runtime.example.com");
  vi.stubEnv("INGENIUM_RUNTIME_SCHEME", "https");
  vi.stubEnv("DASHBOARD_ALLOWED_ORIGINS", "https://legacy.example.com");
  validate.mockReset();
  vi.stubGlobal("fetch", validate);
  server = createServer(handleRuntimeGatewayRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

function ingressRequest(host: string, path = `/?runtimeId=${runtimeId}`, headers: IncomingHttpHeaders = {}, method = "GET") {
  return new Promise<{ status: number; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port: (server.address() as AddressInfo).port, path, method, headers: { ...headers, host } }, (response) => {
      response.resume();
      response.once("end", () => resolve({ status: response.statusCode!, headers: response.headers }));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

describe("CLOUDFLARE-100 GAP 1 label ingress", () => {
  it("consumes all five inventory targets without treating dashboard or API roots as runtime hosts", async () => {
    for (const service of cloudflareTunnel.CLOUDFLARE_SERVICE_IDS) {
      expect(cloudflareIngressForHost(`${service}.example.com`)).toMatchObject({ service, origin: `https://${service}.example.com` });
      expect(runtimeScope({ headers: { host: `${service}.example.com` } })).toBeUndefined();
    }
    expect(cloudflareLauncherOriginAllowed("https://dashboard.example.com", "web")).toBe(true);
    expect(cloudflareLauncherOriginAllowed("https://api.example.com", "web")).toBe(false);
    for (const service of ["dashboard", "api"]) {
      expect((await ingressRequest(`${service}.example.com`)).status).toBe(421);
    }
    expect(validate).not.toHaveBeenCalled();
  });

  it.each(mappings)("authenticates the %s root against the isolated %s host before redirecting", async (service, audience) => {
    const host = `${audience}--${runtimeId}.runtime.example.com`;
    const launcherOrigin = `https://${service}.example.com`;
    validate.mockResolvedValue(new Response(JSON.stringify({ data: { backendName: "runtime-backend", session: { launcherOrigin } } }), { status: 200 }));
    const result = await ingressRequest(`${service}.example.com`, undefined, { authorization: `Bearer ${token}` });
    expect(result.status).toBe(302);
    expect(result.headers.location).toBe(`https://${host}/${audience === "vscode" ? "?folder=/workspace" : ""}`);
    expect(result.headers["content-security-policy"]).toBe(`frame-ancestors ${launcherOrigin}; default-src 'none'`);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(result.headers).not.toHaveProperty("set-cookie");
    const [url, options] = validate.mock.calls[0]!;
    expect(String(url)).toBe("http://api.internal/api/v1/runtimes/gateway/validate");
    expect(JSON.parse(options.body)).toEqual({ sessionToken: token, audience, host, origin: `https://${host}` });
    expect(options.headers.Authorization).toBe(`Bearer ${"g".repeat(43)}`);
    expect(proxyResponseHeaders({}, runtimeScope({ headers: { host } })!, launcherOrigin)["content-security-policy"])
      .toEqual([`frame-ancestors ${launcherOrigin}`]);
  });

  it("rejects missing credentials, shared-root cookies, revoked sessions and cross-UUID sessions", async () => {
    expect((await ingressRequest("opencode.example.com", "/", {}, "HEAD")).status).toBe(401);
    expect((await ingressRequest("opencode.example.com")).status).toBe(401);
    expect((await ingressRequest("opencode.example.com", undefined, { cookie: `__Host-ingenium_runtime_web=${token}` })).status).toBe(401);
    expect(validate).not.toHaveBeenCalled();
    validate.mockImplementation(async () => new Response("{}", { status: 401 }));
    for (const id of [runtimeId, otherRuntimeId]) {
      const result = await ingressRequest("opencode.example.com", `/?runtimeId=${id}`, { authorization: `Bearer ${token}` });
      expect(result.status).toBe(401);
      expect(result.headers).not.toHaveProperty("location");
      expect(JSON.parse(validate.mock.lastCall![1].body).host).toBe(`web--${id}.runtime.example.com`);
    }
    expect(runtimeScope({ headers: { host: `web--${runtimeId}.runtime.example.com` } })?.origin)
      .not.toBe(runtimeScope({ headers: { host: `web--${otherRuntimeId}.runtime.example.com` } })?.origin);
  });

  it("rejects unknown hosts, suffix spoofing, forwarded-host spoofing and malformed launch targets", async () => {
    for (const host of ["unknown.example.com", "opencode.example.com.evil.com", "opencode.example.com:443", `web--${runtimeId}.opencode.example.com`]) {
      expect(cloudflareIngressForHost(host)).toBeUndefined();
      expect((await ingressRequest(host, undefined, { "x-forwarded-host": "opencode.example.com" })).status).toBe(421);
    }
    for (const path of ["/", "/?runtimeId=invalid", `/?runtimeId=${runtimeId}&runtimeId=${otherRuntimeId}`, `/?runtimeId=${runtimeId}&redirect=https://evil.com`, `/__ingenium/exchange?runtimeId=${runtimeId}`]) {
      expect((await ingressRequest("opencode.example.com", path, { authorization: `Bearer ${token}` })).status).toBe(400);
    }
    expect(validate).not.toHaveBeenCalled();
  });

  it("limits label CORS and CSP to the matching runtime audience or dashboard", async () => {
    const host = `web--${runtimeId}.runtime.example.com`;
    const scope = runtimeScope({ headers: { host } })!;
    for (const origin of ["https://opencode.example.com", "https://dashboard.example.com"]) {
      const response = await ingressRequest(host, "/__ingenium/health", { origin, "access-control-request-method": "GET" }, "OPTIONS");
      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(proxyResponseHeaders({}, scope, origin)["content-security-policy"]).toEqual([`frame-ancestors ${origin}`]);
    }
    for (const origin of ["https://cli.example.com", "https://vscode.example.com", "https://api.example.com", "https://opencode.example.com.evil.com"]) {
      expect((await ingressRequest(host, "/__ingenium/health", { origin }, "OPTIONS")).status).toBe(403);
      expect(() => proxyResponseHeaders({}, scope, origin)).toThrow("Dashboard origin is not allowed");
    }
  });

  it("fails closed when the inventory is invalid or missing", async () => {
    writeFileSync(join(directory, "routes.json"), "{}");
    expect((await ingressRequest("opencode.example.com")).status).toBe(421);
    expect(cloudflareLauncherOriginAllowed("https://opencode.example.com", "web")).toBe(false);
    rmSync(join(directory, "routes.json"));
    expect((await ingressRequest("opencode.example.com")).status).toBe(421);
    expect((await ingressRequest(`web--${runtimeId}.runtime.example.com`, "/")).status).toBe(401);
    expect(validate).not.toHaveBeenCalled();
  });
});
