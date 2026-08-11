import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { getDb, projects, resetDbForTest, settings, vault } from "ingenium-core";
import { resetEmailRuntimeForTest } from "ingenium-email";
import { getEmailEncryptionKeyFingerprint } from "../../../packages/ingenium-email/lib/credential-crypto.js";
import { configureEmailRuntimeForApi } from "../lib/email-runtime.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { projectsRouter } from "../lib/routes/projects.js";
import { migrateEmailAccountsToGlobal } from "../lib/routes/emails.js";
import { settingsRouter } from "../lib/routes/settings.js";
import { recoverServerGlobalProviderMetadata } from "../lib/server-global-provider-persistence.js";

let tempDir = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;
const originalApiToken = process.env.INGENIUM_API_TOKEN;
const originalApiTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
const originalEmailEncryptionKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
const API_TOKEN = "a".repeat(32);

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  resetEmailRuntimeForTest();
  if (!vault.isSealed()) vault.sealVault();
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
  if (originalApiToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalApiToken;
  if (originalApiTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalApiTokenFile;
  if (originalEmailEncryptionKey === undefined) delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  else process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = originalEmailEncryptionKey;
});

async function startAuthenticatedRouter(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use("/projects", projectsRouter);
  app.use("/settings", settingsRouter);
  app.use(errorHandler);
  server = createServer(app);
  return await new Promise<string>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
    });
  });
}

function authenticatedJsonHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

describe("project purge route", () => {
  it("returns a typed conflict instead of a 500 for referenced projects", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-project-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    const project = projects.createProject("referenced-project");
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), project.id, "child", now, now);

    const app = express();
    app.use(express.json());
    app.use("/projects", projectsRouter);
    server = createServer(app);
    const baseUrl = await new Promise<string>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
      });
    });

    const response = await fetch(`${baseUrl}/projects/referenced-project/purge`, { method: "DELETE" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PROJECT_HAS_CHILDREN",
        message: "Project has referenced data and cannot be permanently deleted",
        details: { child_tables: ["tasks"] },
      },
    });
  });
});

describe("project route validation", () => {
  async function startRouter(): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use("/projects", projectsRouter);
    server = createServer(app);
    return await new Promise<string>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
    });
  }

  it.each(["", " ", "a/b", ".", "..", "bad\u0000name"])("returns 422 for invalid project names on create: %j", async (name) => {
    const baseUrl = await startRouter();
    const response = await fetch(`${baseUrl}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("returns 422 when either project name in a rename is invalid", async () => {
    const baseUrl = await startRouter();
    const response = await fetch(`${baseUrl}/projects/good-name`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "../bad" }) });
    expect(response.status).toBe(422);
  });

  it("returns 422 for encoded invalid purge names", async () => {
    const baseUrl = await startRouter();
    const response = await fetch(`${baseUrl}/projects/%20/purge`, { method: "DELETE" });
    expect(response.status).toBe(422);
  });

  it("returns 409 when duplicate create requests target the same project", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-project-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    const baseUrl = await startRouter();
    const request = () => fetch(`${baseUrl}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "duplicate" }) });
    const [first, second] = await Promise.all([request(), request()]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
  });

  it("separates archived projects from active lists while preserving archived detail and encoded lifecycle paths", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-project-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    const baseUrl = await startRouter();
    const name = "project ? # % name";
    const encodedName = encodeURIComponent(name);

    const created = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    expect(created.status).toBe(201);
    expect((await fetch(`${baseUrl}/projects`)).status).toBe(200);
    expect((await (await fetch(`${baseUrl}/projects`)).json()).data.map((project: { name: string }) => project.name)).toEqual([name]);

    expect((await fetch(`${baseUrl}/projects/${encodedName}`, { method: "DELETE" })).status).toBe(200);
    expect((await (await fetch(`${baseUrl}/projects`)).json()).data).toEqual([]);
    expect((await (await fetch(`${baseUrl}/projects/archive`)).json()).data.map((project: { name: string }) => project.name)).toEqual([name]);
    expect((await fetch(`${baseUrl}/projects/${encodedName}/detail`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/projects/${encodedName}/restore`, { method: "POST" })).status).toBe(200);
    expect((await (await fetch(`${baseUrl}/projects`)).json()).data.map((project: { name: string }) => project.name)).toEqual([name]);
  });

  it.each([-1, 0.5, null, projects.MAX_PROJECT_RETENTION_DAYS + 1])(
    "rejects invalid retention_days before purge: %p",
    async (retentionDays) => {
      tempDir = mkdtempSync(join(tmpdir(), "ingenium-project-route-"));
      process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
      process.env.INGENIUM_HOME = join(tempDir, "home");
      const project = projects.createProject("retention-route-project");
      expect(projects.archiveProject(project.name)).toBe(true);
      const baseUrl = await startRouter();

      const response = await fetch(`${baseUrl}/projects/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retention_days: retentionDays }),
      });

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      expect(projects.getProject(project.name)).toBeDefined();
    },
  );

  it("denies external global lifecycle changes without creating recovery candidates", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-project-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    process.env.INGENIUM_API_TOKEN = API_TOKEN;
    delete process.env.INGENIUM_API_TOKEN_FILE;
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const baseUrl = await startAuthenticatedRouter();

    const forbiddenCanonicalBootstrap = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authenticatedJsonHeaders(),
      body: JSON.stringify({ name: "global-default", is_global: true }),
    });
    expect(forbiddenCanonicalBootstrap.status).toBe(403);
    const canonical = projects.createProject("global-default", true);

    const externalCreate = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authenticatedJsonHeaders(),
      body: JSON.stringify({ name: "external-project" }),
    });
    expect(externalCreate.status).toBe(201);
    const external = projects.getProject("external-project")!;

    const forbiddenCreate = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authenticatedJsonHeaders(),
      body: JSON.stringify({ name: "forged-global", is_global: true }),
    });
    expect(forbiddenCreate.status).toBe(403);
    await expect(forbiddenCreate.json()).resolves.toMatchObject({
      error: { code: "GLOBAL_PROJECT_LIFECYCLE_FORBIDDEN" },
    });

    const forbiddenPromotion = await fetch(`${baseUrl}/projects/external-project/global`, {
      method: "PATCH",
      headers: authenticatedJsonHeaders(),
      body: JSON.stringify({ is_global: true }),
    });
    expect(forbiddenPromotion.status).toBe(403);

    const forbiddenDemotion = await fetch(`${baseUrl}/projects/global-default/global`, {
      method: "PATCH",
      headers: authenticatedJsonHeaders(),
      body: JSON.stringify({ is_global: false }),
    });
    expect(forbiddenDemotion.status).toBe(403);
    const forbiddenRename = await fetch(`${baseUrl}/projects/global-default`, {
      method: "PATCH",
      headers: authenticatedJsonHeaders(),
      body: JSON.stringify({ name: "renamed-global" }),
    });
    expect(forbiddenRename.status).toBe(403);
    const forbiddenArchive = await fetch(`${baseUrl}/projects/global-default`, {
      method: "DELETE",
      headers: authenticatedJsonHeaders(),
    });
    expect(forbiddenArchive.status).toBe(403);
    expect(projects.getFormerGlobalProjectIds(canonical.id)).toEqual([]);

    expect(vault.initializeVault(canonical.id, "project-route-vault-passphrase", "project-route-vault-passphrase").ok).toBe(true);
    settings.setSetting(external.id, "llm_provider_configs", JSON.stringify([{ id: "external-provider", enabled: true }]));
    settings.setSetting(external.id, "email_account_guarded", JSON.stringify({
      id: "guarded",
      email: "guarded@example.test",
      provider: "custom",
      authType: "app_password",
      connected: false,
    }));
    settings.setSetting(canonical.id, "email_encryption_key_fingerprint", getEmailEncryptionKeyFingerprint());
    const sourceCredentialId = vault.createItem(
      external.id,
      "Managed LLM API Key: external-provider",
      "api_key",
      "external-provider-secret",
    );
    configureEmailRuntimeForApi();

    expect(recoverServerGlobalProviderMetadata()).toEqual({
      migratedSettings: 0,
      migratedCredentials: 0,
      conflicts: 0,
      skippedForVault: false,
      globalUnavailable: false,
    });
    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: false,
    });
    expect(settings.getSetting(external.id, "llm_provider_configs")).toContain("external-provider");
    expect(settings.getSetting(external.id, "email_account_guarded")).toContain("guarded@example.test");
    expect(vault.listItems(external.id).some((item) => item.id === sourceCredentialId)).toBe(true);

    expect(projects.setProjectGlobal(canonical.name, false)).toBe(true);
    const synthesisSave = await fetch(`${baseUrl}/settings?project=external-project`, {
      method: "POST",
      headers: authenticatedJsonHeaders(),
      body: JSON.stringify({ key: "synthesis_model", value: "external-model" }),
    });
    expect(synthesisSave.status).toBe(200);
    const llmSave = await fetch(`${baseUrl}/settings/llm-config?project=external-project`, {
      method: "POST",
      headers: authenticatedJsonHeaders(),
      body: JSON.stringify({
        primary: { provider: "openai", model: "gpt-4.1", endpoint: "https://api.openai.com/v1" },
      }),
    });
    expect(llmSave.status).toBe(200);
    expect(projects.getGlobalProject()).toBeUndefined();

    expect(projects.setProjectGlobal(canonical.name, true)).toBe(true);
    expect(projects.setProjectGlobal(external.name, true)).toBe(true);
    expect(projects.setProjectGlobal(canonical.name, true)).toBe(true);
    expect(projects.getFormerGlobalProjectIds(canonical.id)).toEqual([external.id]);
  });
});
