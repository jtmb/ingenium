import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  logger,
  getDb,
  protectedSettings,
  projects,
  resetDbForTest,
  vault,
} from "ingenium-core";
import { opencodeClient, type OpenCodeResult } from "../lib/opencode-client.js";
import { opencodeRouter } from "../lib/routes/opencode.js";
import { settingsRouter } from "../lib/routes/settings.js";

const PROVIDER_ERROR_CANARY = "phase4c-provider-error-canary-do-not-echo";
const OAUTH_SECRET = "phase4c-gmail-client-secret";
const REPLACEMENT_SECRET = "phase4c-gmail-client-secret-replacement";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;
const originalOpenCodePassword = process.env.OPENCODE_SERVER_PASSWORD;

let tempDir = "";
let server: Server | undefined;
let baseUrl = "";
let projectName = "phase4c-api";

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/settings", settingsRouter);
  app.use("/api/v1/opencode", opencodeRouter);
  return app;
}

beforeEach(async () => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-phase4c-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "canonical", "data.db");
  process.env.INGENIUM_HOME = join(tempDir, "home");
  process.env.OPENCODE_SERVER_PASSWORD = "phase4c-opencode-password";
  projectName = "phase4c-api";
  projects.createProject("global-default", true);
  projects.createProject(projectName);

  server = createServer(buildApp());
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vault.sealVault();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";

  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
  if (originalOpenCodePassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
  else process.env.OPENCODE_SERVER_PASSWORD = originalOpenCodePassword;
});

function projectId(): string {
  return projects.getProject("global-default")!.id;
}

async function getSetting(key: string): Promise<{ response: Response; body: any }> {
  const response = await fetch(
    `${baseUrl}/api/v1/settings?project=${projectName}&key=${encodeURIComponent(key)}`,
  );
  return { response, body: await response.json() };
}

async function updateOAuthSecret(
  action: "preserve" | "replace" | "clear",
  value?: string,
): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}/api/v1/settings?project=${projectName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: "oauth_gmail_client_secret",
      action,
      ...(value === undefined ? {} : { value }),
    }),
  });
  return { response, body: await response.json() };
}

function seedOAuthSecret(): void {
  expect(vault.initializeVault(projectId(), "phase4c-vault-passphrase", "phase4c-vault-passphrase").ok)
    .toBe(true);
  expect(protectedSettings.updateOAuthClientSecret(
    projectId(),
    "oauth_gmail_client_secret",
    "replace",
    OAUTH_SECRET,
  ).status).toBe("ok");
}

function insertLegacyOAuthSecret(value: string): void {
  getDb().prepare(
    `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
  ).run(projectId(), "oauth_gmail_client_secret", value);
}

function rawLegacyOAuthSecret(): string | undefined {
  return (getDb().prepare(
    "SELECT value FROM settings WHERE project_id = ? AND key = ?",
  ).get(projectId(), "oauth_gmail_client_secret") as { value: string } | undefined)?.value;
}

describe("Phase 4C startup ordering", () => {
  it("establishes encryption continuity before migration and before any engine start", () => {
    const source = readFileSync(resolve(__dirname, "../lib/mail-maintenance.ts"), "utf8");
    const startup = source.slice(source.indexOf("setTimeout(() => {"));
    const continuity = startup.indexOf("dependencies.establishContinuity()");
    const migration = startup.indexOf("dependencies.migrateEmailAccounts()");
    const engine = startup.indexOf("dependencies.startEngine()");

    expect(continuity).toBeGreaterThanOrEqual(0);
    expect(migration).toBeGreaterThan(continuity);
    expect(engine).toBeGreaterThan(migration);
    expect(startup.slice(continuity - 32, migration)).toMatch(/try\s*\{/);
    expect(startup.slice(migration, engine)).toMatch(/encryption\.status !== "ready"/);
  });
});

describe("Phase 4C provider-error canary redaction", () => {
  it("does not reflect an upstream provider error canary in the response or API logs", async () => {
    const providerError: OpenCodeResult<never> = {
      error: { code: "ProviderError", message: PROVIDER_ERROR_CANARY },
    };
    vi.spyOn(opencodeClient, "listSessions").mockResolvedValue(providerError);

    const response = await fetch(`${baseUrl}/api/v1/opencode/sessions?directory=%2Fworkspace`);
    const body = await response.text();
    const recentLogs = logger.getLogs({ source: "opencode", limit: 200 });

    expect(response.status).toBe(502);
    expect(body).toContain("OpenCode request failed.");
    expect(body).not.toContain(PROVIDER_ERROR_CANARY);
    expect(JSON.stringify(recentLogs)).not.toContain(PROVIDER_ERROR_CANARY);
  });
});

describe("Phase 4C OAuth client-secret dashboard boundary", () => {
  it("migrates a real plaintext legacy secret after vault unseal and removes its source row", async () => {
    const legacySecret = "phase4c-legacy-client-secret";
    vault.initVault(projectId(), "phase4c-vault-passphrase");
    insertLegacyOAuthSecret(legacySecret);

    const sealed = await getSetting("oauth_gmail_client_secret");
    expect(sealed.response.status).toBe(200);
    expect(sealed.body.data).toMatchObject({ isSet: true, masked: true });
    expect(rawLegacyOAuthSecret()).toBe(legacySecret);

    expect(vault.unsealVault(projectId(), "phase4c-vault-passphrase").ok).toBe(true);
    const migrated = await getSetting("oauth_gmail_client_secret");

    expect(migrated.response.status).toBe(200);
    expect(migrated.body.data).toMatchObject({ isSet: true, masked: true });
    expect(protectedSettings.getOAuthClientSecret(projectId(), "oauth_gmail_client_secret"))
      .toBe(legacySecret);
    expect(rawLegacyOAuthSecret()).toBeUndefined();
  });

  it("retains a legacy value and returns a conflict when protected and legacy values differ", async () => {
    seedOAuthSecret();
    insertLegacyOAuthSecret("phase4c-conflicting-legacy-client-secret");

    const { response, body } = await getSetting("oauth_gmail_client_secret");

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("SECRET_MIGRATION_CONFLICT");
    expect(protectedSettings.getOAuthClientSecret(projectId(), "oauth_gmail_client_secret"))
      .toBe(OAUTH_SECRET);
    expect(rawLegacyOAuthSecret()).toBe("phase4c-conflicting-legacy-client-secret");
  });

  it("never returns an OAuth client secret through the generic dashboard settings endpoint", async () => {
    seedOAuthSecret();

    const { response, body } = await getSetting("oauth_gmail_client_secret");

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      key: "oauth_gmail_client_secret",
      isSet: true,
      masked: true,
    });
    expect(JSON.stringify(body)).not.toContain(OAUTH_SECRET);
  });

  it("preserves a saved OAuth secret when the dashboard submits the masked value", async () => {
    seedOAuthSecret();

    const { response, body } = await updateOAuthSecret("preserve");

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ isSet: true, masked: true });
    expect(protectedSettings.getOAuthClientSecret(projectId(), "oauth_gmail_client_secret")).toBe(OAUTH_SECRET);
  });

  it("replaces a saved OAuth secret only when a new non-masked value is supplied", async () => {
    seedOAuthSecret();

    const { response, body } = await updateOAuthSecret("replace", REPLACEMENT_SECRET);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ isSet: true, masked: true });
    expect(protectedSettings.getOAuthClientSecret(projectId(), "oauth_gmail_client_secret")).toBe(REPLACEMENT_SECRET);
    const responseText = JSON.stringify((await getSetting("oauth_gmail_client_secret")).body);
    expect(responseText).not.toContain(REPLACEMENT_SECRET);
  });

  it("clears a saved OAuth secret only on an explicit empty value", async () => {
    seedOAuthSecret();

    const { response, body } = await updateOAuthSecret("clear");

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ isSet: false, masked: false });
    expect(protectedSettings.getOAuthClientSecret(projectId(), "oauth_gmail_client_secret")).toBeUndefined();
  });

  it("fails safely and preserves the existing OAuth secret when vault storage is unavailable", async () => {
    seedOAuthSecret();
    vault.sealVault();

    const { response, body } = await updateOAuthSecret("replace", REPLACEMENT_SECRET);

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("VAULT_REQUIRED");
    expect(JSON.stringify(body)).not.toContain(REPLACEMENT_SECRET);
    expect(protectedSettings.getOAuthClientSecret(projectId(), "oauth_gmail_client_secret")).toBeUndefined();
    expect(vault.unsealVault(projectId(), "phase4c-vault-passphrase").ok).toBe(true);
    expect(protectedSettings.getOAuthClientSecret(projectId(), "oauth_gmail_client_secret")).toBe(OAUTH_SECRET);
  });
});
