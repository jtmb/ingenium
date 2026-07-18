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

const passphrase = "correct horse battery staple";
const plaintext = "my-secret-value";
let tempDir: string;
let server: Server;
let baseUrl: string;
let itemId: string;
const projectName = "vault-api-test";
let projectId: string;

function vaultPath(path: string): string {
  return `${baseUrl}/api/v1/vault${path}${path.includes("?") ? "&" : "?"}project=${projectName}`;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-vault-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "vault.db");
  projectId = createProject(projectName).id;
  initVault(projectId, passphrase);

  const app = express();
  app.use(express.json());
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
    expect(await response.text()).not.toContain(plaintext);
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
    core.resetDbForTest();
    initializationTempDir = mkdtempSync(join(tmpdir(), "ingenium-vault-initialize-api-"));
    vi.stubEnv("INGENIUM_CORE_DB_PATH", join(initializationTempDir, "vault.db"));
    core.projects.createProject(initializationProject);

    const app = express();
    app.use(express.json());
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

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("VAULT_NOT_INITIALIZED");
  });
});
