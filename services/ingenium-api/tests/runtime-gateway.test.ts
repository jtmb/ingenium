import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gatewayRequestHeaders, proxyResponseHeaders, runtimeCookie, runtimeScope, sanitizedHeaders } from "../scripts/runtime-gateway.js";

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
  it("accepts only an exact audience runtime host", () => {
    expect(runtimeScope({ headers: { host: `web--${runtimeId}.runtime.example.test` } })).toEqual({
      audience: "web",
      runtimeId,
      host: `web--${runtimeId}.runtime.example.test`,
      origin: `https://web--${runtimeId}.runtime.example.test`,
    });
    expect(runtimeScope({ headers: { host: `cli--${runtimeId}.runtime.example.test.evil.test` } })).toBeUndefined();
    expect(runtimeScope({ headers: { host: `web--${runtimeId}.runtime.example.test:443` } })).toBeUndefined();
  });

  it("strips browser credentials, identity, and proxy-chain headers on HTTP and WebSocket requests", () => {
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
    expect(headers).not.toHaveProperty("x-ingenium-authenticated-user");
    expect(headers).not.toHaveProperty("x-ingenium-audience");
    expect(headers).not.toHaveProperty("x-ingenium-private-network");
  });

  it("uses a host-only secure audience cookie and a restrictive frame policy", () => {
    const token = `rbs_${"a".repeat(43)}`;
    expect(runtimeCookie("vscode", token, 60)).toBe(
      `__Host-ingenium_runtime_vscode=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=60`,
    );
    expect(runtimeCookie("vscode", token, 60)).not.toContain("Domain=");
    const scope = runtimeScope({ headers: { host: `vscode--${runtimeId}.runtime.example.test` } })!;
    const headers = proxyResponseHeaders({
      "content-security-policy": "default-src 'self'",
      "x-frame-options": "DENY",
      "set-cookie": "upstream=secret",
      location: `http://ingenium-runtime-${runtimeId.replaceAll("-", "")}:4100/path`,
    }, scope);
    expect(headers["content-security-policy"]).toEqual(["default-src 'self'", "frame-ancestors https://dashboard.example.test"]);
    expect(headers).not.toHaveProperty("x-frame-options");
    expect(headers).not.toHaveProperty("set-cookie");
    expect(headers.location).toBe(`${scope.origin}/path`);
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
});
