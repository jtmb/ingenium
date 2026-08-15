import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  gatewayRequestHeaders,
  isRuntimeGenerationRequest,
  isRuntimeHealthRequest,
  proxyResponseHeaders,
  runtimeBackendHealthPath,
  runtimeCookie,
  runtimeScope,
  sanitizedHeaders,
} from "../scripts/runtime-gateway.js";

const runtimeId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  process.env.INGENIUM_RUNTIME_ROOT_DOMAIN = "runtime.example.test";
  process.env.DASHBOARD_ALLOWED_ORIGINS = "https://dashboard.example.test";
});

afterEach(() => {
  delete process.env.INGENIUM_RUNTIME_ROOT_DOMAIN;
  delete process.env.DASHBOARD_ALLOWED_ORIGINS;
});

describe("AUTH-109 runtime gateway", () => {
  it.each(["web", "cli", "vscode"] as const)("accepts only an exact %s runtime host", (audience) => {
    expect(runtimeScope({ headers: { host: `${audience}--${runtimeId}.runtime.example.test` } })).toEqual({
      audience,
      runtimeId,
      host: `${audience}--${runtimeId}.runtime.example.test`,
      origin: `https://${audience}--${runtimeId}.runtime.example.test`,
    });
    expect(runtimeScope({ headers: { host: `cli--${runtimeId}.runtime.example.test.evil.test` } })).toBeUndefined();
    expect(runtimeScope({ headers: { host: `web--${runtimeId}.runtime.example.test:443` } })).toBeUndefined();
  });

  it("strips browser identity and injects only the fixed CLI identity", () => {
    const scope = runtimeScope({ headers: { host: `cli--${runtimeId}.runtime.example.test` } })!;
    const headers = sanitizedHeaders({
      authorization: "Bearer browser-controlled",
      cookie: "secret=value",
      forwarded: "for=spoofed",
      "x-ingenium-authenticated-user": "admin",
      "x-forwarded-for": "spoofed",
      "x-ingenium-audience": "runtime-gateway",
      "x-ingenium-private-network": "runtime-gateway",
      "sec-websocket-key": "safe-key",
      origin: "https://evil.test",
    }, scope, true);
    expect(headers).toMatchObject({ host: scope.host, origin: scope.origin, connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "safe-key" });
    expect(headers).not.toHaveProperty("authorization");
    expect(headers).not.toHaveProperty("cookie");
    expect(headers).not.toHaveProperty("forwarded");
    expect(headers).not.toHaveProperty("x-forwarded-for");
    expect(headers["x-ingenium-authenticated-user"]).toBe("runtime");
    expect(headers).not.toHaveProperty("x-ingenium-audience");
    expect(headers).not.toHaveProperty("x-ingenium-private-network");
    const webScope = runtimeScope({ headers: { host: `web--${runtimeId}.runtime.example.test` } })!;
    expect(sanitizedHeaders({ "x-ingenium-authenticated-user": "admin" }, webScope))
      .not.toHaveProperty("x-ingenium-authenticated-user");
  });

  it.each(["web", "cli", "vscode"] as const)("uses a host-only secure %s cookie and replaces upstream frame denial", (audience) => {
    const token = `rbs_${"a".repeat(43)}`;
    expect(runtimeCookie(audience, token, 60)).toBe(
      `__Host-ingenium_runtime_${audience}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=60`,
    );
    expect(runtimeCookie(audience, token, 60)).not.toContain("Domain=");
    const scope = runtimeScope({ headers: { host: `${audience}--${runtimeId}.runtime.example.test` } })!;
    const headers = proxyResponseHeaders({
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
      "set-cookie": "upstream=secret",
      location: `http://ingenium-runtime-${runtimeId.replaceAll("-", "")}:4100/path`,
    }, scope, "https://dashboard.example.test");
    expect(headers["content-security-policy"]).toEqual(["default-src 'self'", "frame-ancestors https://dashboard.example.test"]);
    expect(String(headers["content-security-policy"])).not.toContain("frame-ancestors 'none'");
    expect(String(headers["content-security-policy"])).not.toContain("frame-ancestors *");
    expect(headers).not.toHaveProperty("x-frame-options");
    expect(headers).not.toHaveProperty("set-cookie");
    expect(headers.location).toBe(`${scope.origin}/path`);
  });

  it.each([
    ["web", "/"],
    ["cli", "/"],
    ["vscode", "/?folder=/workspace"],
  ] as const)("probes the exact %s audience root before reporting ready", (audience, path) => {
    expect(runtimeBackendHealthPath(audience)).toBe(path);
  });

  it("sends only the dedicated audience for the API boundary to attest", () => {
    const headers = gatewayRequestHeaders("g".repeat(43));
    expect(headers).toEqual({
      Authorization: `Bearer ${"g".repeat(43)}`,
      "Content-Type": "application/json",
      "X-Ingenium-Audience": "runtime-gateway",
    });
    expect(headers).not.toHaveProperty("X-Ingenium-Private-Network");
    expect(headers).not.toHaveProperty("X-Ingenium-Runtime-Gateway");
  });

  it("excludes health polling while identifying generation request lifecycles", () => {
    expect(isRuntimeHealthRequest({ method: "GET", url: "/global/health" })).toBe(true);
    expect(isRuntimeHealthRequest({ method: "HEAD", url: "/healthz" })).toBe(true);
    expect(isRuntimeHealthRequest({ method: "GET", url: "/session/status" })).toBe(true);
    expect(isRuntimeHealthRequest({ method: "POST", url: "/global/health" })).toBe(false);
    expect(isRuntimeHealthRequest({ method: "GET", url: "/session/one/message" })).toBe(false);

    expect(isRuntimeGenerationRequest({ method: "POST", url: "/session/one/message" })).toBe(true);
    expect(isRuntimeGenerationRequest({ method: "POST", url: "/session/one/prompt_async?directory=%2Fworkspace" })).toBe(true);
    expect(isRuntimeGenerationRequest({ method: "GET", url: "/session/one/message" })).toBe(false);
    expect(isRuntimeGenerationRequest({ method: "POST", url: "/health" })).toBe(false);
  });
});
