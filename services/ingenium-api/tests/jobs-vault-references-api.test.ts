import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDbForTest } from "ingenium-core";
import { createProject } from "../../../packages/ingenium-core/lib/tools/projects.js";
import { createItem, deleteItem, initVault, sealVault, unsealVault } from "../../../packages/ingenium-core/lib/tools/vault.js";
import { jobsRouter } from "../lib/routes/jobs.js";

const passphrase = "jobs API vault reference passphrase";
const canary = "api-job-vault-canary-secret";
let directory = "";
let server: Server;
let baseUrl = "";
let firstProjectId = "";
let secondProjectId = "";
let firstItemId = "";
let deletedItemId = "";
let foreignItemId = "";
let jobId = "";

function request(path: string, project: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}/api/v1/jobs${path}${path.includes("?") ? "&" : "?"}project=${project}`, init);
}

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-jobs-vault-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  firstProjectId = createProject("jobs-vault-api-first").id;
  secondProjectId = createProject("jobs-vault-api-second").id;
  initVault(firstProjectId, passphrase);
  expect(unsealVault(firstProjectId, passphrase).ok).toBe(true);
  firstItemId = createItem(firstProjectId, "api-reference", "api_key", canary);
  deletedItemId = createItem(firstProjectId, "api-deleted", "api_key", "deleted-canary");
  foreignItemId = createItem(secondProjectId, "api-foreign", "api_key", "foreign-canary");
  deleteItem(firstProjectId, deletedItemId);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/jobs", jobsRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  }));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  sealVault();
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("VAULT-100 jobs API", () => {
  it("creates a metadata-only reference and never serializes vault metadata or a canary", async () => {
    const response = await request("/", "jobs-vault-api-first", json({
      name: "Vault job",
      agent: "agent",
      prompt_template: "prompt",
      vault_item_ids: [firstItemId],
    }));
    const text = await response.text();
    const body = JSON.parse(text);
    jobId = body.data.id;

    expect(response.status).toBe(201);
    expect(body.data.vault_references).toEqual([
      expect.objectContaining({ item_id: firstItemId, availability: "available", item_version: 1 }),
    ]);
    expect(Object.keys(body.data.vault_references[0]).sort()).toEqual(["authorized_at", "availability", "item_id", "item_version"]);
    expect(text).not.toContain(canary);
    expect(text).not.toContain("api-reference");
    expect(text).not.toContain("encrypted");
  });

  it("preserves omitted references, revokes explicit empty lists, and remains identical while sealed", async () => {
    const beforeSeal = await request(`/${jobId}`, "jobs-vault-api-first");
    const beforeSealBody = await beforeSeal.json();
    sealVault();
    const sealedGet = await request(`/${jobId}`, "jobs-vault-api-first");
    const sealedList = await request("/", "jobs-vault-api-first");

    expect(sealedGet.status).toBe(200);
    expect(await sealedGet.json()).toEqual(beforeSealBody);
    expect((await sealedList.json()).data.find((job: { id: string }) => job.id === jobId)).toEqual(beforeSealBody.data);

    expect(unsealVault(firstProjectId, passphrase).ok).toBe(true);
    const preserved = await request(`/${jobId}`, "jobs-vault-api-first", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed vault job" }),
    });
    expect((await preserved.json()).data.vault_references).toHaveLength(1);

    const revoked = await request(`/${jobId}`, "jobs-vault-api-first", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault_item_ids: [] }),
    });
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).data.vault_references).toEqual([]);
  });

  it("uses the same generic 422 response for missing, deleted, and foreign item IDs", async () => {
    const unavailable = [
      "00000000-0000-4000-8000-000000000001",
      deletedItemId,
      foreignItemId,
    ];
    const responses = await Promise.all(unavailable.map(async (itemId) => {
      const response = await request("/", "jobs-vault-api-first", json({
        name: "Unavailable job",
        agent: "agent",
        prompt_template: "prompt",
        vault_item_ids: [itemId],
      }));
      return { status: response.status, body: await response.json() };
    }));

    expect(responses).toEqual([
      { status: 422, body: { error: { code: "VAULT_ITEM_NOT_FOUND", message: "A vault item reference is unavailable" } } },
      { status: 422, body: { error: { code: "VAULT_ITEM_NOT_FOUND", message: "A vault item reference is unavailable" } } },
      { status: 422, body: { error: { code: "VAULT_ITEM_NOT_FOUND", message: "A vault item reference is unavailable" } } },
    ]);
    expect((await request(`/${jobId}`, "jobs-vault-api-second")).status).toBe(404);
  });

  it("rejects malformed lists without adding a reference-resolution endpoint", async () => {
    const response = await request("/", "jobs-vault-api-first", json({
      name: "Malformed",
      agent: "agent",
      prompt_template: "prompt",
      vault_item_ids: [firstItemId, firstItemId],
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect((await request(`/items/${firstItemId}`, "jobs-vault-api-first")).status).toBe(404);
  });
});
