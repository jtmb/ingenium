import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { authMiddleware } from "../lib/middleware/auth.js";
import { authPreflightReadRateLimit, clearRateLimitEntries, rateLimit } from "../lib/middleware/rate-limit.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { oidcAuthentication, runtimes } from "ingenium-core";
import { AppError } from "../lib/middleware/errors.js";
import { clearAuthAttemptRateLimit } from "../lib/middleware/auth-rate-limit.js";
import { inspectManagedRuntime } from "../lib/runtime-manager-client.js";
import { authPreflightRouter, publicOidcError } from "../lib/routes/auth-preflight.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

vi.mock("../lib/runtime-manager-client.js", () => ({ inspectManagedRuntime: vi.fn() }));

const token = "b".repeat(32);
const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const runtimeId = "33333333-3333-4333-8333-333333333333";
const credentialId = "44444444-4444-4444-8444-444444444444";
const servicePrincipalId = "55555555-5555-4555-8555-555555555555";
const backendId = "c".repeat(64);
let server: Server | undefined;
let baseUrl = "";
let originalToken: string | undefined;
let originalTokenFile: string | undefined;

beforeEach(async () => {
  originalToken = process.env.INGENIUM_API_TOKEN;
  originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  process.env.INGENIUM_API_TOKEN = token;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  clearAuthAttemptRateLimit();
  clearRateLimitEntries();
  const app = express();
  app.use(authPreflightReadRateLimit);
  app.use(rateLimit);
  app.use(authMiddleware);
  app.use(authorizationMiddleware);
  app.use((req, _res, next) => {
    const audience = req.get("x-test-preflight-audience");
    if (audience === "mcp" || audience === "runtime" || audience === "repository-sync") {
      const scopes = req.get("x-test-preflight-scopes")?.split(",") ?? ["projects:read"];
      req.principal = {
        type: "service",
        id: servicePrincipalId,
        scopes,
        tokenId: credentialId,
        organizationId,
        projectId,
        projectIds: [projectId],
        audience,
        workspaceId: "workspace-id",
        launcherWorktree: "/workspace",
        storageMappingHash: "a".repeat(64),
      };
      if ((audience === "mcp" || audience === "runtime") && req.get("x-test-preflight-attestation") !== "missing") {
        req.attestedCoordinationIdentity = Object.freeze({
          credentialId,
          workspaceId: "workspace-id",
          storageMappingHash: "a".repeat(64),
        });
      }
    }
    next();
  });
  app.use("/api/v1/auth", authPreflightRouter);
  app.use(errorHandler);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(async () => {
  await closeHttpServer(server!);
  clearRateLimitEntries();
  vi.restoreAllMocks();
  vi.mocked(inspectManagedRuntime).mockReset();
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
});

describe("extension authentication preflight", () => {
  it("confirms only successful authentication", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight`, {
      headers: { Authorization: `Bearer ${token}`, "X-Ingenium-Internal-Service": "1" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { authenticated: true } });
  });

  it("does not disclose credentials when authentication fails", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight`);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body.error).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("advertises targeted live MCP reload for protected credential content rotation", async () => {
    const runtimeScope = vi.spyOn(runtimes, "resolveRuntimePreflightScope");
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Ingenium-Internal-Service": "1",
        "X-Test-Preflight-Audience": "mcp",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        audience: "mcp",
        credentialChangeMode: "live-mcp-reload",
        restartRequiredOnCredentialChange: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(runtimeScope).not.toHaveBeenCalled();
    expect(inspectManagedRuntime).not.toHaveBeenCalled();
  });

  it.each(["runtime", "repository-sync"] as const)("keeps restart mode for %s credential bindings", async (audience) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Ingenium-Internal-Service": "1",
        "X-Test-Preflight-Audience": audience,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: {
      audience,
      credentialChangeMode: "restart",
      restartRequiredOnCredentialChange: true,
    } });
  });

  it.each(["READY", "IDLE"] as const)("returns the DB-authorized %s runtime state without exposing manager state", async (state) => {
    const runtime = {
      id: runtimeId,
      organizationId,
      projectId,
      workspaceId: "workspace-id",
      backendName: `ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
      backendContainerId: backendId,
      state,
    } as runtimes.RuntimeInstance;
    const scope = vi.spyOn(runtimes, "resolveRuntimePreflightScope").mockReturnValue(runtime);
    vi.mocked(inspectManagedRuntime).mockResolvedValue({
      runtimeId,
      backendId,
      backendName: runtime.backendName,
      imageRevision: "d".repeat(40),
      state: "running",
      health: "healthy",
    });

    const response = await fetch(`${baseUrl}/api/v1/auth/preflight?runtime_id=${runtimeId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Ingenium-Internal-Service": "1",
        "X-Test-Preflight-Audience": "runtime",
        "X-Test-Preflight-Scopes": "projects:read,runtime:activity",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: {
      authenticated: true,
      principal: { type: "service", id: servicePrincipalId },
      scopes: ["projects:read", "runtime:activity"],
      organizationId,
      projectId,
      projectIds: [projectId],
      audience: "runtime",
      workspaceId: "workspace-id",
      launcherWorktree: "/workspace",
      storageMappingHash: "a".repeat(64),
      restartRequiredOnCredentialChange: true,
      credentialChangeMode: "restart",
      runtime: { id: runtimeId, imageRevision: "d".repeat(40), state },
    } });
    expect(JSON.stringify(body)).not.toContain('"running"');
    expect(scope).toHaveBeenCalledWith({
      runtimeId,
      organizationId,
      projectId,
      workspaceId: "workspace-id",
      storageMappingHash: "a".repeat(64),
    });
    expect(inspectManagedRuntime).toHaveBeenCalledWith(runtimeId);
  });

  it.each([
    `runtime_id=invalid`,
    `runtime_id=${runtimeId}&runtime_id=${runtimeId}`,
    `runtime_id=${runtimeId}&workspace_id=workspace-id`,
  ])("rejects malformed or additional runtime assertions: %s", async (query) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight?${query}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Ingenium-Internal-Service": "1",
        "X-Test-Preflight-Audience": "runtime",
        "X-Test-Preflight-Scopes": "projects:read,runtime:activity",
      },
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(inspectManagedRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ["mcp", "projects:read,runtime:activity"],
    ["repository-sync", "projects:read,runtime:activity"],
    ["runtime", "projects:read"],
  ])("requires a runtime audience and both fixed scopes (%s)", async (audience, scopes) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight?runtime_id=${runtimeId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Ingenium-Internal-Service": "1",
        "X-Test-Preflight-Audience": audience,
        "X-Test-Preflight-Scopes": scopes,
      },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed when the runtime identity is not attested", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight?runtime_id=${runtimeId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Ingenium-Internal-Service": "1",
        "X-Test-Preflight-Audience": "runtime",
        "X-Test-Preflight-Scopes": "projects:read,runtime:activity",
        "X-Test-Preflight-Attestation": "missing",
      },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({ code: "NOT_FOUND", message: "Resource not found" });
  });

  it.each(["absent", "foreign", "mismatch", "revoked", "epoch", "state"])(
    "keeps %s runtime resolution indistinguishable",
    async () => {
      vi.spyOn(runtimes, "resolveRuntimePreflightScope").mockReturnValue(undefined);
      const response = await fetch(`${baseUrl}/api/v1/auth/preflight?runtime_id=${runtimeId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Ingenium-Internal-Service": "1",
          "X-Test-Preflight-Audience": "runtime",
          "X-Test-Preflight-Scopes": "projects:read,runtime:activity",
        },
      });

      expect(response.status).toBe(404);
      expect((await response.json()).error).toMatchObject({
        code: "NOT_FOUND",
        message: "Resource not found",
        details: null,
      });
      expect(inspectManagedRuntime).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["runtime identity", { runtimeId: "66666666-6666-4666-8666-666666666666" }],
    ["backend identity", { backendId: "e".repeat(64) }],
    ["backend name", { backendName: "ingenium-runtime-foreign" }],
    ["container state", { state: "exited" }],
    ["container health", { health: "unhealthy" }],
    ["image provenance", { imageRevision: "INVALID" }],
  ])("maps a mismatched %s to service unavailable", async (_label, override) => {
    const runtime = {
      id: runtimeId,
      organizationId,
      projectId,
      workspaceId: "workspace-id",
      backendName: `ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
      backendContainerId: backendId,
      state: "READY",
    } as runtimes.RuntimeInstance;
    vi.spyOn(runtimes, "resolveRuntimePreflightScope").mockReturnValue(runtime);
    vi.mocked(inspectManagedRuntime).mockResolvedValue({
      runtimeId,
      backendId,
      backendName: runtime.backendName,
      imageRevision: "d".repeat(40),
      state: "running",
      health: "healthy",
      ...override,
    });

    const response = await fetch(`${baseUrl}/api/v1/auth/preflight?runtime_id=${runtimeId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Ingenium-Internal-Service": "1",
        "X-Test-Preflight-Audience": "runtime",
        "X-Test-Preflight-Scopes": "projects:read,runtime:activity",
      },
    });

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatchObject({ code: "RUNTIME_MANAGER_UNAVAILABLE" });
  });

  it("maps Runtime Manager faults to service unavailable", async () => {
    const runtime = {
      id: runtimeId,
      organizationId,
      projectId,
      workspaceId: "workspace-id",
      backendName: `ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
      backendContainerId: backendId,
      state: "IDLE",
    } as runtimes.RuntimeInstance;
    vi.spyOn(runtimes, "resolveRuntimePreflightScope").mockReturnValue(runtime);
    vi.mocked(inspectManagedRuntime).mockRejectedValue(new Error("manager secret detail"));

    const response = await fetch(`${baseUrl}/api/v1/auth/preflight?runtime_id=${runtimeId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Ingenium-Internal-Service": "1",
        "X-Test-Preflight-Audience": "runtime",
        "X-Test-Preflight-Scopes": "projects:read,runtime:activity",
      },
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: "RUNTIME_MANAGER_UNAVAILABLE", message: "Runtime manager is unavailable" });
    expect(JSON.stringify(body)).not.toContain("manager secret detail");
  });
});

describe("login preflight reads", () => {
  it.each([
    "/api/v1/auth/csrf",
    "/api/v1/auth/oidc/providers",
  ])("serves side-effect-free HEAD for %s", async (path) => {
    const response = await fetch(`${baseUrl}${path}`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it.each([
    ["POST", "/api/v1/auth/csrf"],
    ["GET", "/api/v1/auth/csrf/"],
    ["GET", "/api/v1/auth/%63srf"],
    ["GET", "/api/v1/auth//csrf"],
    ["GET", "/api/v1/auth/oidc/providers/"],
  ])("does not public-allowlist %s %s", async (method, path) => {
    expect((await fetch(`${baseUrl}${path}`, { method })).status).toBe(401);
  });
});

describe("OIDC public errors", () => {
  it("rate-limits malformed callbacks before validation", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await fetch(`${baseUrl}/api/v1/auth/oidc/callback?state=x&code=x`)).status).not.toBe(429);
    }
    expect((await fetch(`${baseUrl}/api/v1/auth/oidc/callback?state=x&code=x`)).status).toBe(429);
  });

  it.each([
    ["authentication", 401, "OIDC_AUTHENTICATION_FAILED"],
    ["upstream", 502, "OIDC_PROVIDER_UNAVAILABLE"],
    ["timeout", 504, "OIDC_PROVIDER_TIMEOUT"],
  ] as const)("maps %s failures to a fixed redacted envelope", (kind, status, code) => {
    const mapped = publicOidcError(new oidcAuthentication.OidcError(kind, {
      cause: new Error("https://provider.invalid token=secret 10.0.0.1"),
    })) as AppError;
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.statusCode).toBe(status);
    expect(mapped.code).toBe(code);
    expect(`${mapped.message} ${JSON.stringify(mapped.details)}`).not.toMatch(/provider\.invalid|secret|10\.0\.0\.1/);
  });
});
