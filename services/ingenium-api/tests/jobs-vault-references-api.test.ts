import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDbForTest } from "ingenium-core";
import { createProject } from "../../../packages/ingenium-core/lib/tools/projects.js";
import { createItem, deleteItem, initVault, sealVault, unsealVault, updateItem } from "../../../packages/ingenium-core/lib/tools/vault.js";
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
    expect(body.data.revision).toBe(0);
    expect(body.data.vault_references).toEqual([
      expect.objectContaining({ item_id: firstItemId, status: "authorized", authorized_item_version: 1 }),
    ]);
    expect(Object.keys(body.data.vault_references[0]).sort()).toEqual(["authorized_at", "authorized_item_version", "item_id", "status"]);
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
      body: JSON.stringify({ name: "Renamed vault job", expected_revision: beforeSealBody.data.revision }),
    });
    const preservedBody = await preserved.json();
    expect(preservedBody.data.vault_references).toHaveLength(1);

    const revoked = await request(`/${jobId}`, "jobs-vault-api-first", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault_item_ids: [], expected_revision: preservedBody.data.revision }),
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

  it("refreshes an authorization version only when the current same-ID list is explicitly PATCHed", async () => {
    const created = await request("/", "jobs-vault-api-first", json({
      name: "Refresh vault job",
      agent: "agent",
      prompt_template: "prompt",
      vault_item_ids: [firstItemId],
    }));
    const freshJobId = (await created.json()).data.id as string;
    updateItem(firstProjectId, firstItemId, "rotated-api-job-vault-canary-secret");

    const omitted = await request(`/${freshJobId}`, "jobs-vault-api-first", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Still stale", expected_revision: 0 }),
    });
    const omittedBody = await omitted.json();
    expect(omittedBody.data.vault_references[0]).toMatchObject({ authorized_item_version: 1, status: "version_stale" });

    const refreshed = await request(`/${freshJobId}`, "jobs-vault-api-first", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault_item_ids: [firstItemId], expected_revision: omittedBody.data.revision }),
    });
    expect((await refreshed.json()).data.vault_references[0]).toMatchObject({ authorized_item_version: 2, status: "authorized" });
  });

  it("requires expected_revision, returns a bounded CAS conflict, and exposes fixed-shape vault audit pages", async () => {
    const missing = await request(`/${jobId}`, "jobs-vault-api-first", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "missing revision" }),
    });
    expect(missing.status).toBe(422);
    expect((await missing.json()).error.code).toBe("VALIDATION_ERROR");

    const current = await request(`/${jobId}`, "jobs-vault-api-first");
    const revision = (await current.json()).data.revision as number;
    const updated = await request(`/${jobId}`, "jobs-vault-api-first", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "CAS update", expected_revision: revision }),
    });
    expect(updated.status).toBe(200);
    const conflict = await request(`/${jobId}`, "jobs-vault-api-first", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "stale", expected_revision: revision }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: { code: "JOB_REVISION_CONFLICT", message: "Job has changed. Reload before saving.", currentRevision: revision + 1 },
    });

    const audit = await request(`/${jobId}/vault-audit?limit=1`, "jobs-vault-api-first");
    expect(audit.status).toBe(200);
    const body = await audit.json();
    expect(body.data).toHaveLength(1);
    expect(Object.keys(body.data[0]).sort()).toEqual(["action", "actor_category", "id", "item_id", "job_id", "run_id", "timestamp", "version"]);
    expect(JSON.stringify(body)).not.toContain(canary);
    expect(JSON.stringify(body)).not.toContain("api-reference");
  });
});
