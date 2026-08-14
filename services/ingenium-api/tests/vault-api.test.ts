import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initVault } from "../../../packages/ingenium-core/lib/tools/vault.js";
import * as core from "ingenium-core";
import { createProject } from "../../../packages/ingenium-core/lib/tools/projects.js";
import { vaultRouter } from "../lib/routes/vault.js";
import { vaultBruteForceLimiter } from "../lib/middleware/rate-limit.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { errorHandler } from "../lib/middleware/errors.js";

const passphrase = "correct horse battery staple";
const plaintext = "my-secret-value";
let tempDir: string;
let server: Server;
let baseUrl: string;
let itemId: string;
const projectName = "vault-api-test";
let projectId: string;

function attachCompatibilityPrincipal(app: express.Express): void {
  app.use((req, _res, next) => {
    req.principal = { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] };
    next();
  });
}

function vaultPath(path: string): string {
  return `${baseUrl}/api/v1/vault${path}${path.includes("?") ? "&" : "?"}project=${projectName}`;
}

beforeAll(async () => {
  vaultBruteForceLimiter.clear();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-vault-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "vault.db");
  projectId = createProject(projectName).id;
  initVault(projectId, passphrase);

  const app = express();
  app.use(express.json());
  attachCompatibilityPrincipal(app);
  app.use("/api/v1/vault", vaultRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vaultBruteForceLimiter.clear();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

describe("vault API", () => {
  it("returns sealed status initially", async () => {
    const response = await fetch(vaultPath("/status"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.sealed).toBe(true);
  });

  it("rejects a wrong passphrase", async () => {
    const response = await fetch(vaultPath("/unseal"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong" }) });
    expect(response.status).toBe(403);
  });

  it("unseals with the correct passphrase", async () => {
    const response = await fetch(vaultPath("/unseal"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: passphrase }) });
    expect(response.status).toBe(200);
  });

  it("accepts the MCP passphrase alias", async () => {
    await fetch(vaultPath("/seal"), { method: "POST" });
    const response = await fetch(vaultPath("/unseal"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data.unsealed).toBe(true);
  });

  it("creates and lists folders with item counts", async () => {
    const create = await fetch(vaultPath("/folders"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Work" }) });
    expect(create.status).toBe(201);
    const list = await fetch(vaultPath("/folders"));
    expect(list.status).toBe(200);
    expect((await list.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Work", item_count: 0 })]));
  });

  it("rejects item listing while sealed", async () => {
    await fetch(vaultPath("/seal"), { method: "POST" });
    const response = await fetch(vaultPath("/items"));
    expect(response.status).toBe(503);
    await fetch(vaultPath("/unseal"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: passphrase }) });
  });

  it("creates an item and returns metadata only", async () => {
    const response = await fetch(vaultPath("/items"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "api-secret", type: "api_key", value: plaintext }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    itemId = body.data.id;
    expect(JSON.stringify(body)).not.toContain(plaintext);
  });

  it("reveals an item's plaintext", async () => {
    const response = await fetch(vaultPath(`/items/${itemId}/reveal`), { method: "POST" });
    expect(response.status).toBe(200);
    expect((await response.json()).data.value).toBe(plaintext);
  });

  it("marks reveal responses as non-cacheable", async () => {
    const response = await fetch(vaultPath(`/items/${itemId}/reveal`), { method: "POST" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("updates an item value", async () => {
    const response = await fetch(vaultPath(`/items/${itemId}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "updated-secret" }) });
    expect(response.status).toBe(200);
    const reveal = await fetch(vaultPath(`/items/${itemId}/reveal`), { method: "POST" });
    expect((await reveal.json()).data.value).toBe("updated-secret");
  });

  it("updates item metadata through the dashboard contract", async () => {
    const response = await fetch(vaultPath(`/items/${itemId}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "renamed-secret", tags: "work, api", urls: "https://example.com" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(expect.objectContaining({ name: "renamed-secret", tags: "work, api", urls: "https://example.com" }));
  });

  it("rotates an item and returns the new value without caching", async () => {
    const response = await fetch(vaultPath(`/items/${itemId}/rotate`), { method: "POST" });
    expect(response.status).toBe(200);
    const value = (await response.json()).data.value as string;
    expect(value).toHaveLength(24);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("supports the dashboard password generation endpoint", async () => {
    const response = await fetch(vaultPath("/password/generate"), { method: "POST" });
    expect(response.status).toBe(200);
    expect((await response.json()).data.password).toHaveLength(24);
  });

  it("deletes an item", async () => {
    const response = await fetch(vaultPath(`/items/${itemId}`), { method: "DELETE" });
    expect(response.status).toBe(204);
  });

  it("seals the vault", async () => {
    const response = await fetch(vaultPath("/seal"), { method: "POST" });
    expect(response.status).toBe(200);
    expect((await (await fetch(vaultPath("/status"))).json()).data.sealed).toBe(true);
    await fetch(vaultPath("/unseal"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: passphrase }) });
  });

  it("generates a strong password", async () => {
    const response = await fetch(vaultPath("/generate-password"), { method: "POST" });
    const password = (await response.json()).data.password as string;
    expect(response.status).toBe(200);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it("returns audit events", async () => {
    const response = await fetch(vaultPath("/audit"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  it("never includes plaintext in list responses", async () => {
    const create = await fetch(vaultPath("/items"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "scan-target", type: "api_key", value: plaintext }) });
    expect(create.status).toBe(201);
    const response = await fetch(vaultPath("/items"));
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(text).not.toContain(plaintext);
    expect(body.data[0]).toEqual(expect.objectContaining({ version: expect.any(Number) }));
    expect(body.data[0]).not.toHaveProperty("value");
  });

  it("records one canonical and one linked vault audit event for a request replay", async () => {
    const requestId = "auth104-vault-replay";
    const create = await fetch(vaultPath("/items"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": requestId },
      body: JSON.stringify({ name: `request-replay-${Date.now()}`, type: "note", value: "request-replay-secret" }),
    });
    const createdId = (await create.json()).data.id as string;
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await fetch(vaultPath(`/items/${createdId}/reveal`), {
        method: "POST",
        headers: { "x-request-id": requestId },
      })).status).toBe(200);
    }

    expect(core.getDb().prepare(
      "SELECT count(*) AS count FROM resource_audit_events WHERE request_id = ? AND action = 'secret_read' AND resource_id = ?",
    ).get(requestId, createdId)).toEqual({ count: 1 });
    expect(core.getDb().prepare(
      "SELECT count(*) AS count FROM vault_audit_log WHERE request_id = ? AND event_type = 'secret_read' AND item_id = ? AND source_audit_event_id IS NOT NULL",
    ).get(requestId, createdId)).toEqual({ count: 1 });
  });
});

describe("POST /initialize", () => {
  const initializationProject = "vault-initialize-api-test";
  let initializationTempDir: string;
  let initializationServer: Server;
  let initializationBaseUrl: string;

  const initializePath = (path: string): string =>
    `${initializationBaseUrl}/api/v1/vault${path}?project=${initializationProject}`;

  beforeEach(async () => {
    vaultBruteForceLimiter.clear();
    core.resetDbForTest();
    initializationTempDir = mkdtempSync(join(tmpdir(), "ingenium-vault-initialize-api-"));
    vi.stubEnv("INGENIUM_CORE_DB_PATH", join(initializationTempDir, "vault.db"));
    core.projects.createProject(initializationProject);

    const app = express();
    app.use(express.json());
    attachCompatibilityPrincipal(app);
    app.use("/api/v1/vault", vaultRouter);
    initializationServer = createServer(app);
    await new Promise<void>((resolve) => {
      initializationServer.listen(0, "127.0.0.1", () => {
        initializationBaseUrl = `http://127.0.0.1:${(initializationServer.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    vaultBruteForceLimiter.clear();
    await new Promise<void>((resolve) => initializationServer.close(() => resolve()));
    core.vault.sealVault();
    core.resetDbForTest();
    vi.unstubAllEnvs();
    rmSync(initializationTempDir, { recursive: true, force: true });
  });

  it("initializes and unseals a fresh vault", async () => {
    const response = await fetch(initializePath("/initialize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passphrase, confirmation: passphrase }),
    });

    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual({ ok: true, unsealed: true });
  });

  it("rejects mismatched confirmation", async () => {
    const response = await fetch(initializePath("/initialize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passphrase, confirmation: "different confirmation" }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toBe("Passphrases do not match");
  });

  it("rejects short passphrases", async () => {
    const response = await fetch(initializePath("/initialize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "too-short", confirmation: "too-short" }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toBe("Passphrase must be at least 12 characters");
  });

  it("rejects a second initialization", async () => {
    const body = JSON.stringify({ password: passphrase, confirmation: passphrase });
    await fetch(initializePath("/initialize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const response = await fetch(initializePath("/initialize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("ALREADY_INITIALIZED");
  });

  it("does not auto-initialize dashboard unseal requests", async () => {
    const response = await fetch(initializePath("/unseal"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingenium-ui": "dashboard" },
      body: JSON.stringify({ password: passphrase }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("VAULT_NOT_INITIALIZED");
  });

  it("enforces the shared passphrase policy before MCP auto-initialization", async () => {
    const response = await fetch(initializePath("/unseal"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "too-short" }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Passphrase must be at least 12 characters",
    });
    const status = await fetch(initializePath("/status"));
    expect((await status.json()).data).toMatchObject({ sealed: true, initialized: false, nextAction: "initialize" });
  });

  it("auto-initializes a valid MCP unseal request without returning the passphrase", async () => {
    const response = await fetch(initializePath("/unseal"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('"unsealed":true');
    expect(body).not.toContain(passphrase);
  });

  it("rate-limits only passphrase attempts and honors Retry-After", async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const status = await fetch(initializePath("/status"));
      expect(status.status).toBe(200);
      const itemList = await fetch(initializePath("/items"));
      expect(itemList.status).toBe(409);
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(initializePath("/initialize"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passphrase, confirmation: "different passphrase" }),
      });
      expect(response.status).toBe(422);
    }

    const limited = await fetch(initializePath("/unseal"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");

    // Normal status remains available instead of causing a retry loop while the
    // client is waiting for its passphrase-attempt cooldown to expire.
    expect((await fetch(initializePath("/status"))).status).toBe(200);
  });

  it("redacts audit details from the API response", async () => {
    await fetch(initializePath("/initialize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passphrase, confirmation: passphrase }),
    });
    const secret = "audit-api-secret-value";
    const created = await fetch(initializePath("/items"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "audit-item", type: "note", value: secret }),
    });
    expect(created.status).toBe(201);

    const audit = await fetch(initializePath("/audit"));
    const body = await audit.text();
    expect(audit.status).toBe(200);
    expect(body).not.toContain(secret);
    expect(body).not.toContain(passphrase);
    expect(JSON.parse(body).data[0]).not.toHaveProperty("details");
  });
});

describe("vault lifecycle authorization", () => {
  let lifecycleDirectory: string;
  let lifecycleServer: Server;
  let lifecycleBaseUrl: string;
  let lifecycleProject: string;
  let principals: Record<string, Express.Request["principal"]>;

  beforeEach(async () => {
    vaultBruteForceLimiter.clear();
    core.resetDbForTest();
    lifecycleDirectory = mkdtempSync(join(tmpdir(), "ingenium-vault-lifecycle-api-"));
    vi.stubEnv("INGENIUM_CORE_DB_PATH", join(lifecycleDirectory, "vault.db"));
    lifecycleProject = `vault-lifecycle-${Date.now()}`;
    const project = core.projects.createProject(lifecycleProject);
    const installationAdmin = core.identity.createUser("vault-admin@example.test", "Vault Admin");
    const projectEditor = core.identity.createUser("vault-editor@example.test", "Vault Editor");
    core.organizations.addOrganizationMember(project.organization_id, projectEditor.id, "member");
    core.organizations.addProjectMember(project.id, projectEditor.id, "editor");
    core.getDb().prepare("INSERT INTO installation_admins (user_id, created_at) VALUES (?, ?)")
      .run(installationAdmin.id, new Date().toISOString());

    principals = {
      "admin-recent": {
        type: "user",
        id: installationAdmin.id,
        scopes: ["user:*"],
        session: core.authentication.createSession(installationAdmin.id, new Date(), "vault matrix", true).session,
      },
      "admin-stale": {
        type: "user",
        id: installationAdmin.id,
        scopes: ["user:*"],
        session: core.authentication.createSession(installationAdmin.id).session,
      },
      "editor-recent": {
        type: "user",
        id: projectEditor.id,
        scopes: ["user:*"],
        session: core.authentication.createSession(projectEditor.id, new Date(), "vault matrix", true).session,
      },
      compatibility: { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] },
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.principal = principals[String(req.headers["x-test-principal"] ?? "")];
      next();
    });
    app.use(authorizationMiddleware);
    app.use("/api/v1/vault", vaultRouter);
    app.use(errorHandler);
    lifecycleServer = createServer(app);
    await new Promise<void>((resolve) => lifecycleServer.listen(0, "127.0.0.1", resolve));
    lifecycleBaseUrl = `http://127.0.0.1:${(lifecycleServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vaultBruteForceLimiter.clear();
    await new Promise<void>((resolve) => lifecycleServer.close(() => resolve()));
    core.vault.sealVault();
    core.resetDbForTest();
    vi.unstubAllEnvs();
    rmSync(lifecycleDirectory, { recursive: true, force: true });
  });

  async function lifecycleRequest(operation: "initialize" | "seal" | "unseal", principal: string): Promise<Response> {
    return fetch(`${lifecycleBaseUrl}/api/v1/vault/${operation}?project=${lifecycleProject}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-principal": principal },
      body: operation === "seal" ? undefined : JSON.stringify(operation === "initialize"
        ? { password: passphrase, confirmation: passphrase }
        : { password: passphrase }),
    });
  }

  it("allows only a recently elevated installation administrator", async () => {
    expect((await lifecycleRequest("initialize", "editor-recent")).status).toBe(403);
    const staleInitialize = await lifecycleRequest("initialize", "admin-stale");
    expect(staleInitialize.status).toBe(403);
    expect((await staleInitialize.json()).error.code).toBe("STEP_UP_REQUIRED");
    expect((await lifecycleRequest("initialize", "compatibility")).status).toBe(403);
    expect((await lifecycleRequest("initialize", "admin-recent")).status).toBe(201);

    expect((await lifecycleRequest("seal", "editor-recent")).status).toBe(403);
    expect((await lifecycleRequest("seal", "admin-stale")).status).toBe(403);
    expect((await lifecycleRequest("seal", "admin-recent")).status).toBe(200);

    expect((await lifecycleRequest("unseal", "editor-recent")).status).toBe(403);
    expect((await lifecycleRequest("unseal", "admin-stale")).status).toBe(403);
    expect((await lifecycleRequest("unseal", "admin-recent")).status).toBe(200);
  });
});
