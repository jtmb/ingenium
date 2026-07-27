import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { logger } from "ingenium-core";

const mocks = vi.hoisted(() => ({
  getMCPStatus: vi.fn(),
  connectMCP: vi.fn(),
  disconnectMCP: vi.fn(),
}));

vi.mock("../lib/opencode-client.js", () => ({
  opencodeClient: {
    getMCPStatus: mocks.getMCPStatus,
    connectMCP: mocks.connectMCP,
    disconnectMCP: mocks.disconnectMCP,
  },
  isOpenCodeError: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
}));

let server: Server | null = null;
let baseUrl: string;

beforeAll(async () => {
  const { opencodeRouter } = await import("../lib/routes/opencode.js");
  const app = express();
  app.use(express.json());
  app.use("/api/v1/opencode", opencodeRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}/api/v1/opencode`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

beforeEach(() => {
  vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-password");
  mocks.getMCPStatus.mockResolvedValue({});
  mocks.connectMCP.mockResolvedValue({ ok: true });
  mocks.disconnectMCP.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("OpenCode MCP status proxy contract", () => {
  it.each([
    "connected",
    "disabled",
    "failed",
    "needs_auth",
    "needs_client_registration",
  ] as const)("normalizes the v1.18.3 %s status", async (status) => {
    mocks.getMCPStatus.mockResolvedValue({ alpha: { status, tools: 2, error: "upstream diagnostic" } });

    const response = await fetch(`${baseUrl}/mcp`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.alpha.status).toBe(status);
    expect(body.data.alpha.connected).toBe(status === "connected");
    expect(body.data.alpha.toolCount).toBe(2);
    expect(JSON.stringify(body)).not.toContain("upstream diagnostic");
  });

  it("retains legacy boolean compatibility", async () => {
    mocks.getMCPStatus.mockResolvedValue({ legacy: { connected: true }, disabled: { connected: false } });

    const body = await (await fetch(`${baseUrl}/mcp`)).json();
    expect(body.data.legacy).toMatchObject({ status: "connected", connected: true });
    expect(body.data.disabled).toMatchObject({ status: "disabled", connected: false });
  });

  it("prefers tagged status over legacy booleans and normalizes tool arrays", async () => {
    mocks.getMCPStatus.mockResolvedValue({
      tagged: { status: "failed", connected: true, tools: [{}, {}, {}], error: "secret diagnostic" },
      invalidCount: { status: "connected", toolCount: -1 },
    });

    const body = await (await fetch(`${baseUrl}/mcp`)).json();

    expect(body.data.tagged).toEqual({
      status: "failed",
      connected: false,
      toolCount: 3,
      error: "MCP server failed to connect.",
    });
    expect(body.data.invalidCount).toEqual({ status: "connected", connected: true });
    expect(JSON.stringify(body)).not.toContain("secret diagnostic");
  });

  it("projects unknown and malformed server states into a safe distinct state", async () => {
    mocks.getMCPStatus.mockResolvedValue({
      unknown: { status: "restarting", error: "token=do-not-leak" },
      malformed: null,
    });

    const body = await (await fetch(`${baseUrl}/mcp`)).json();
    expect(body.data.unknown).toEqual({
      status: "unknown",
      connected: false,
      error: "MCP server returned an unrecognized status.",
    });
    expect(body.data.malformed).toEqual(body.data.unknown);
    expect(JSON.stringify(body)).not.toContain("token=do-not-leak");
  });

  it("filters secret-shaped MCP server keys before they become browser DTO object keys", async () => {
    const secretKeyCanary = "sk-mcp-key-scalar-canary-ABCDEFGHI";
    const secretNamedCanary = "mcp-secret-scalar-canary";
    mocks.getMCPStatus.mockResolvedValue({
      alpha: { status: "connected" },
      [secretKeyCanary]: { status: "connected" },
      [secretNamedCanary]: { status: "failed", error: "hidden diagnostic" },
    });

    const body = await (await fetch(`${baseUrl}/mcp`)).json();

    expect(body).toEqual({ data: { alpha: { status: "connected", connected: true } } });
    expect(JSON.stringify(body)).not.toContain(secretKeyCanary);
    expect(JSON.stringify(body)).not.toContain(secretNamedCanary);
  });

  it("returns a visible API error for a malformed root response", async () => {
    mocks.getMCPStatus.mockResolvedValue([]);

    const response = await fetch(`${baseUrl}/mcp`);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "MCP_STATUS_INVALID", message: "OpenCode returned an invalid MCP status response." },
    });
  });

  it("returns a fixed status error without forwarding or logging a secret-bearing upstream code", async () => {
    const upstreamCode = "ProviderSecretCodeA9B8C7";
    const warn = vi.spyOn(logger, "warn");
    mocks.getMCPStatus.mockResolvedValue({
      error: { code: upstreamCode, message: "secret upstream response" },
    });

    const response = await fetch(`${baseUrl}/mcp`);
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      error: { code: "MCP_STATUS_FAILED", message: "Unable to retrieve MCP server status." },
    });
    expect(JSON.stringify(payload)).not.toContain(upstreamCode);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(upstreamCode);
    warn.mockRestore();
  });

  it("returns fixed mutation errors without reflecting a secret-bearing alphanumeric upstream code", async () => {
    const upstreamCode = "ProviderSecretCodeA9B8C7";
    mocks.connectMCP.mockResolvedValue({ error: { code: upstreamCode, message: "secret upstream response" } });
    mocks.disconnectMCP.mockResolvedValue({ error: { code: upstreamCode, message: "secret upstream response" } });

    const connect = await fetch(`${baseUrl}/mcp/alpha/connect`, { method: "POST" });
    const disconnect = await fetch(`${baseUrl}/mcp/alpha/disconnect`, { method: "POST" });

    expect(connect.status).toBe(502);
    expect(disconnect.status).toBe(502);
    const connectBody = await connect.json();
    const disconnectBody = await disconnect.json();
    expect(connectBody).toEqual({
      error: { code: "MCP_CONNECT_FAILED", message: "Unable to connect to the MCP server." },
    });
    expect(disconnectBody).toEqual({
      error: { code: "MCP_DISCONNECT_FAILED", message: "Unable to disconnect from the MCP server." },
    });
    expect(JSON.stringify({ connectBody, disconnectBody })).not.toContain(upstreamCode);
  });

  it("returns a fixed success DTO and never proxies secret-bearing mutation bodies", async () => {
    mocks.connectMCP.mockResolvedValue({
      endpoint: "http://127.0.0.1:4567/internal",
      apiKey: "connect-secret",
      nested: { token: "connect-token" },
    });
    mocks.disconnectMCP.mockResolvedValue({
      endpoint: "http://127.0.0.1:4567/internal",
      password: "disconnect-secret",
      details: { authorization: "Bearer disconnect-token" },
    });

    const connect = await fetch(`${baseUrl}/mcp/alpha/connect`, { method: "POST" });
    const disconnect = await fetch(`${baseUrl}/mcp/alpha/disconnect`, { method: "POST" });
    const connectBody = await connect.json();
    const disconnectBody = await disconnect.json();

    expect(connect.status).toBe(200);
    expect(disconnect.status).toBe(200);
    expect(connectBody).toEqual({ data: { accepted: true } });
    expect(disconnectBody).toEqual({ data: { accepted: true } });
    const serialized = JSON.stringify({ connectBody, disconnectBody });
    for (const forbidden of [
      "127.0.0.1:4567",
      "connect-secret",
      "connect-token",
      "disconnect-secret",
      "disconnect-token",
      "endpoint",
      "apiKey",
      "password",
      "authorization",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects invalid or secret-shaped MCP server names before an upstream connect or disconnect call", async () => {
    const connect = await fetch(`${baseUrl}/mcp/invalid%20name/connect`, { method: "POST" });
    const disconnect = await fetch(`${baseUrl}/mcp/invalid%20name/disconnect`, { method: "POST" });

    expect(connect.status).toBe(422);
    expect(disconnect.status).toBe(422);
    await expect(connect.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid MCP server name" },
    });
    await expect(disconnect.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid MCP server name" },
    });
    expect(mocks.connectMCP).not.toHaveBeenCalled();
    expect(mocks.disconnectMCP).not.toHaveBeenCalled();

    const secretConnect = await fetch(`${baseUrl}/mcp/sk-mcp-route-scalar-canary-ABCDEFGHI/connect`, { method: "POST" });
    const secretDisconnect = await fetch(`${baseUrl}/mcp/sk-mcp-route-scalar-canary-ABCDEFGHI/disconnect`, { method: "POST" });
    expect(secretConnect.status).toBe(422);
    expect(secretDisconnect.status).toBe(422);
    expect(mocks.connectMCP).not.toHaveBeenCalled();
    expect(mocks.disconnectMCP).not.toHaveBeenCalled();
  });
});
