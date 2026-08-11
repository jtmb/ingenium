/**
 * llm-config.test.ts — Integration tests for LLM config endpoints.
 *
 * Tests the Phase 2 LLM config endpoints:
 *   - GET  /settings/llm-config    → Read atomic LLM config (no raw keys)
 *   - POST /settings/llm-config    → Save atomic LLM config
 *   - GET  /opencode/chat-config   → Sanitized Chat config (no raw keys)
 *   - POST /settings/test-llm      → Requires project context
 *
 * Uses a temporary SQLite database and an isolated Express server
 * (same pattern as dashboard.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { projects, settings, configs, resetDbForTest, vault } from "ingenium-core";
import { settingsRouter } from "../lib/routes/settings.js";
import { opencodeRouter } from "../lib/routes/opencode.js";
import { opencodeClient } from "../lib/opencode-client.js";

// ── Test server setup ──────────────────────────────────────────────────────

let tempDir: string;
let projectName: string;
let server: Server | null = null;
let baseUrl: string;
// Keep the real transport outside individual tests. A test that temporarily
// intercepts the provider request must still be able to call its local Express
// fixture even if another test has restored or replaced global fetch.
const nativeFetch = globalThis.fetch.bind(globalThis);

/** MUST be a function — evaluates projectName at call time, not module load time. */
function projectQ(name?: string): string {
  return `?project=${name ?? projectName}`;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/settings", settingsRouter);
  app.use("/api/v1/opencode", opencodeRouter);
  return app;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-llm-config-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");

  const globalProjectId = projects.createProject("global-default", true).id;
  projectName = "llm-config-test-project";
  projects.createProject(projectName);
  // Provider credentials are intentionally vault-only. Tests unseal the same
  // encrypted storage the production route requires before supplying a key.
  expect(vault.initializeVault(globalProjectId, "test-vault-passphrase", "test-vault-passphrase").ok).toBe(true);
  vi.spyOn(opencodeClient, "addAuth").mockResolvedValue({});
  vi.spyOn(opencodeClient, "deleteAuth").mockResolvedValue({});
  // Chat config always performs runtime provider discovery. Keep this fixture
  // isolated from the real OpenCode password/configuration state unless a test
  // explicitly exercises an unavailable catalog.
  vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({ all: [] });

  // Start a local server for fetch-based testing
  const app = buildApp();
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** POST to /settings/llm-config with a body and return the response. */
function postLlmConfig(body: Record<string, unknown>, project = projectName) {
  return fetch(`${baseUrl}/api/v1/settings/llm-config${projectQ(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** GET /settings/llm-config and return the parsed response. */
async function getLlmConfig() {
  const res = await fetch(`${baseUrl}/api/v1/settings/llm-config${projectQ()}`);
  const body = await res.json();
  return { res, body };
}

/** GET /opencode/chat-config and return the parsed response. */
async function getChatConfig() {
  const res = await fetch(`${baseUrl}/api/v1/opencode/chat-config${projectQ()}`);
  const body = await res.json();
  return { res, body };
}

async function getBuiltinProviders() {
  const res = await fetch(`${baseUrl}/api/v1/opencode/builtin-providers`);
  const body = await res.json();
  return { res, body };
}

function runtimeProviderList() {
  return {
    all: [{
      id: "opencode",
      name: "OpenCode Zen",
      source: "custom",
      env: ["OPENCODE_API_KEY"],
      options: { apiKey: "public" },
      models: {
        "big-pickle": {
          id: "big-pickle",
          name: "Big Pickle",
          providerID: "opencode",
          status: "active",
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          options: { apiKey: "public" },
        },
        paid: {
          id: "paid",
          name: "Paid Model",
          providerID: "opencode",
          status: "active",
          cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
        },
        inactive: {
          id: "inactive",
          name: "Inactive Model",
          providerID: "opencode",
          status: "inactive",
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        },
      },
    }],
    default: { opencode: "big-pickle" },
    connected: ["opencode"],
  } as any;
}

function setManagedChatCatalog(entries: Array<Record<string, unknown>>, name = "global-default"): void {
  settings.setSetting(
    projects.getProject(name)!.id,
    "llm_provider_configs",
    JSON.stringify(entries),
  );
}

function putProviderConfigs(providers: Array<Record<string, unknown>>) {
  return fetch(`${baseUrl}/api/v1/settings/provider-configs${projectQ()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providers }),
  });
}

async function getProviderConfigs() {
  const res = await fetch(`${baseUrl}/api/v1/settings/provider-configs${projectQ()}`);
  return { res, body: await res.json() };
}

describe("managed provider blocks", () => {
  const providers = [
    {
      id: "openai-main",
      name: "OpenAI Main",
      npm: "@ai-sdk/openai",
      baseURL: "https://api.openai.com/v1",
      models: ["gpt-4.1", "gpt-4.1-mini"],
      defaultModel: "gpt-4.1",
      role: "primary",
      enabled: true,
      apiKey: "primary-provider-secret",
    },
    {
      id: "anthropic-backup",
      name: "Anthropic Backup",
      npm: "@ai-sdk/anthropic",
      baseURL: "https://api.anthropic.com/v1",
      models: ["claude-sonnet-4-6"],
      defaultModel: "claude-sonnet-4-6",
      role: "backup",
      enabled: true,
      apiKey: "backup-provider-secret",
    },
    {
      id: "deepseek-extra",
      name: "DeepSeek Extra",
      npm: "@ai-sdk/deepseek",
      baseURL: "https://api.deepseek.com/v1",
      models: ["deepseek-chat"],
      defaultModel: "deepseek-chat",
      role: "available",
      enabled: true,
      apiKey: "extra-provider-secret",
    },
  ];

  it("saves arbitrary provider blocks and projects valid OpenCode provider entries", async () => {
    const response = await putProviderConfigs(providers);
    expect(response.status).toBe(200);

    const { body } = await getProviderConfigs();
    expect(body.data.providers).toHaveLength(3);
    expect(body.data.providers.every((provider: any) => provider.apiKeySet)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("provider-secret");

    expect(settings.getSetting(projects.getGlobalProject()!.id, "synthesis_provider")).toBe("openai-main");
    expect(settings.getSetting(projects.getGlobalProject()!.id, "synthesis_backup_provider")).toBe("anthropic-backup");
    expect(settings.getSetting(projects.getProject(projectName)!.id, "llm_provider_configs")).toBeUndefined();

    const config = JSON.parse(configs.getConfig(projects.getGlobalProject()!.id, "global")!.content);
    expect(config.provider["openai-main"]).toEqual({
      name: "OpenAI Main",
      npm: "@ai-sdk/openai",
      options: { baseURL: "https://api.openai.com/v1" },
      models: {
        "gpt-4.1": { id: "gpt-4.1", name: "gpt-4.1" },
        "gpt-4.1-mini": { id: "gpt-4.1-mini", name: "gpt-4.1-mini" },
      },
    });
    expect(JSON.stringify(config)).not.toContain("provider-secret");
  });

  it("preserves omitted credentials and removes deleted provider projections", async () => {
    const withoutKeys = providers.slice(0, 2).map(({ apiKey: _apiKey, ...provider }) => provider);
    const response = await putProviderConfigs(withoutKeys);
    expect(response.status).toBe(200);

    const { body } = await getProviderConfigs();
    expect(body.data.providers).toHaveLength(2);
    expect(body.data.providers.every((provider: any) => provider.apiKeySet)).toBe(true);

    const config = JSON.parse(configs.getConfig(projects.getGlobalProject()!.id, "global")!.content);
    expect(config.provider["deepseek-extra"]).toBeUndefined();
  });

  it("keeps disabled blocks in Settings but excludes them from OpenCode and synthesis roles", async () => {
    const disabledPrimary = { ...providers[0]!, enabled: false };
    const response = await putProviderConfigs([disabledPrimary]);
    expect(response.status).toBe(200);

    const { body } = await getProviderConfigs();
    expect(body.data.providers[0].enabled).toBe(false);
    expect(settings.getSetting(projects.getGlobalProject()!.id, "synthesis_provider")).toBe("");

    const config = JSON.parse(configs.getConfig(projects.getGlobalProject()!.id, "global")!.content);
    expect(config.provider["openai-main"]).toBeUndefined();
  });

  it("clears a managed credential only when apiKey is explicitly empty", async () => {
    await putProviderConfigs([providers[0]!]);
    const { apiKey: _apiKey, ...withoutKey } = providers[0]!;
    await putProviderConfigs([{ ...withoutKey, apiKey: "" }]);

    const { body } = await getProviderConfigs();
    expect(body.data.providers[0].apiKeySet).toBe(false);
    expect(opencodeClient.deleteAuth).toHaveBeenCalledWith("openai-main", "/workspace");
  });

  it("does not save provider settings when a vault credential write fails", async () => {
    const projectId = projects.getGlobalProject()!.id;
    const createItem = vi.spyOn(vault, "createItem").mockImplementationOnce(() => {
      throw new Error("simulated vault storage failure");
    });

    const response = await putProviderConfigs([{
      id: "vault-write-failure",
      name: "Vault Write Failure",
      npm: "@ai-sdk/openai",
      baseURL: "https://api.openai.com/v1",
      models: ["test-model"],
      defaultModel: "test-model",
      roles: ["available", "primary"],
      enabled: true,
      apiKey: "test-only-credential",
    }]);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toEqual({
      code: "VAULT_WRITE_FAILED",
      message: "Could not save API credentials. Verify the vault is available and try again.",
    });
    expect(JSON.stringify(body)).not.toContain("simulated vault storage failure");
    expect(settings.getSetting(projectId, "llm_provider_configs") ?? "").not.toContain("vault-write-failure");
    expect(vault.listItems(projectId).some((item: any) => item.name === "Managed LLM API Key: vault-write-failure")).toBe(false);
    createItem.mockRestore();
  });

  it("keeps legacy settings when migration cannot write a vault credential", async () => {
    const project = projects.createProject("llm-config-legacy-vault-failure");
    settings.setSetting(project.id, "synthesis_provider", "legacy-failure-provider");
    settings.setSetting(project.id, "synthesis_model", "legacy-model");
    settings.setSetting(project.id, "synthesis_api_key", "legacy-test-credential");
    const createItem = vi.spyOn(vault, "createItem").mockImplementationOnce(() => {
      throw new Error("simulated legacy vault failure");
    });

    const response = await fetch(`${baseUrl}/api/v1/settings/llm-config${projectQ("llm-config-legacy-vault-failure")}`);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("VAULT_WRITE_FAILED");
    expect(settings.getSetting(project.id, "synthesis_api_key")).toBe("legacy-test-credential");
    createItem.mockRestore();
  });

  it("migrates and removes the fixed-name primary vault credential", async () => {
    const project = projects.createProject("llm-config-fixed-vault-migration");
    settings.setSetting(project.id, "synthesis_provider", "legacy-fixed-provider");
    settings.setSetting(project.id, "synthesis_model", "legacy-model");
    vault.createItem(project.id, "Synthesis Primary API Key", "api_key", "legacy-fixed-credential");

    const response = await fetch(`${baseUrl}/api/v1/settings/llm-config${projectQ("llm-config-fixed-vault-migration")}`);

    expect(response.status).toBe(200);
    const items = vault.listItems(project.id) as Array<{ id: string; name: string }>;
    expect(items.some((item) => item.name === "Synthesis Primary API Key")).toBe(false);
    const migrated = items.find((item) => item.name === "Managed LLM API Key: legacy-fixed-provider");
    expect(migrated?.id).toBeTruthy();
    expect(vault.decryptItem(project.id, migrated!.id)).toBe("legacy-fixed-credential");
  });

  it("rejects duplicate IDs and permits one provider in both roles when models differ", async () => {
    const response = await putProviderConfigs([
      providers[0]!,
      { ...providers[0]!, name: "Duplicate", role: "primary" },
    ]);
    expect(response.status).toBe(422);

    const overlappingRolesResponse = await fetch(`${baseUrl}/api/v1/settings/provider-configs${projectQ()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers: [{
      ...providers[0]!,
          models: ["gpt-4.1", "gpt-4.1-mini"],
      roles: ["available", "primary", "backup"],
        }],
        synthesis: {
          primary: { providerId: "openai-main", modelId: "gpt-4.1" },
          secondary: { providerId: "openai-main", modelId: "gpt-4.1-mini" },
        },
      }),
    });
    expect(overlappingRolesResponse.status).toBe(200);
  });

  it("rejects the builtin opencode ID from managed provider configuration", async () => {
    const response = await putProviderConfigs([{ ...providers[0]!, id: "opencode" }]);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "providers[0].id is reserved for a built-in provider",
      },
    });
  });

  it("rejects identical primary and secondary provider-model selections", async () => {
    const response = await fetch(`${baseUrl}/api/v1/settings/provider-configs${projectQ()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers: [{ ...providers[0]!, roles: ["available", "primary", "backup"] }],
        synthesis: {
          primary: { providerId: "openai-main", modelId: "gpt-4.1" },
          secondary: { providerId: "openai-main", modelId: "gpt-4.1" },
        },
      }),
    });
    expect(response.status).toBe(422);
  });

  it("rejects provider packages outside the execution allowlist", async () => {
    const response = await putProviderConfigs([{ ...providers[0]!, npm: "untrusted-provider-package" }]);
    expect(response.status).toBe(422);
  });

  it("normalizes persisted scalar roles to roles arrays", async () => {
    const projectId = projects.getGlobalProject()!.id;
    settings.setSetting(projectId, "llm_provider_configs", JSON.stringify([{
      ...providers[0]!,
      role: "primary",
    }]));

    const { body } = await getProviderConfigs();
    expect(body.data.providers[0].roles).toEqual(["available", "primary"]);
    expect(body.data.providers[0]).not.toHaveProperty("role");
  });

  it("permits explicitly enabled private-network provider endpoints", async () => {
    const response = await putProviderConfigs([{
      ...providers[0]!,
      baseURL: "http://127.0.0.1:11434/v1",
      allowPrivateNetwork: true,
    }]);
    expect(response.status).toBe(200);

    const { body } = await getProviderConfigs();
    expect(body.data.providers[0].allowPrivateNetwork).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test 1: POST saves and GET retrieves correctly
   ══════════════════════════════════════════════════════════════════════════ */

describe("POST /settings/llm-config → GET /settings/llm-config round-trip", () => {
  it("preserves an omitted saved credential across a database reconnect", async () => {
    const postRes = await postLlmConfig({
      primary: {
        provider: "openai",
        model: "test-model",
        apiKey: "test-credential",
        endpoint: "https://api.openai.com/v1",
      },
    });
    expect(postRes.status).toBe(200);

    // This mirrors a process restart: the DB singleton reconnects to the same
    // persisted file, then Settings loads sanitized metadata only.
    resetDbForTest();
    const { body: beforeSave } = await getLlmConfig();
    expect(beforeSave.data.primary.provider).toBe("openai");
    expect(beforeSave.data.primary.apiKeySet).toBe(true);
    expect(JSON.stringify(beforeSave)).not.toContain("test-credential");

    const updateRes = await postLlmConfig({
      primary: {
        provider: "openai",
        model: "test-model-updated",
        endpoint: "https://api.openai.com/v1",
      },
    });
    expect(updateRes.status).toBe(200);

    const { body: afterSave } = await getLlmConfig();
    expect(afterSave.data.primary.model).toBe("test-model-updated");
    expect(afterSave.data.primary.apiKeySet).toBe(true);
    expect(JSON.stringify(afterSave)).not.toContain("test-credential");
  });

  it("clears a credential only when the request explicitly supplies an empty string", async () => {
    await postLlmConfig({
      primary: {
        provider: "openai",
        model: "clear-test-model",
        apiKey: "test-key-to-clear",
        endpoint: "https://api.openai.com/v1",
      },
    });

    const clearRes = await postLlmConfig({
      primary: {
        provider: "openai",
        model: "clear-test-model",
        apiKey: "",
        endpoint: "https://api.openai.com/v1",
      },
    });
    expect(clearRes.status).toBe(200);

    const { body } = await getLlmConfig();
    expect(body.data.primary.apiKeySet).toBe(false);
  });

  it("saves and retrieves primary + backup config with apiKeySet=true when keys set", async () => {
    const postRes = await postLlmConfig({
      primary: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        apiKey: "sk-test-key",
        endpoint: "https://api.deepseek.com/v1",
      },
      backup: {
        provider: "openai",
        model: "gpt-4",
        apiKey: "sk-backup-key",
        endpoint: "https://api.openai.com/v1",
      },
    });
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.data).toBeDefined();
    expect(postBody.data.saved).toBe(true);
    expect(postBody.data).not.toHaveProperty("restartRequired");

    // GET should retrieve the saved values
    const { body } = await getLlmConfig();

    expect(body.data.primary.provider).toBe("deepseek");
    expect(body.data.primary.model).toBe("deepseek-v4-pro");
    expect(body.data.primary.endpoint).toBe("https://api.deepseek.com/v1");
    expect(body.data.primary.apiKeySet).toBe(true);

    // backup should be non-null with matching values
    expect(body.data.backup).not.toBeNull();
    expect(body.data.backup.provider).toBe("openai");
    expect(body.data.backup.model).toBe("gpt-4");
    expect(body.data.backup.endpoint).toBe("https://api.openai.com/v1");
    expect(body.data.backup.apiKeySet).toBe(true);
  });

  it("returns apiKeySet=false when no API key is saved", async () => {
    // POST with empty apiKey for primary, omit backup
    const postRes = await postLlmConfig({
      primary: {
        provider: "lmstudio",
        model: "qwen3.5-9b",
        apiKey: "",
        endpoint: "",
      },
    });
    expect(postRes.status).toBe(200);

    const { body } = await getLlmConfig();

    expect(body.data.primary.provider).toBe("lmstudio");
    expect(body.data.primary.model).toBe("qwen3.5-9b");
    expect(body.data.primary.apiKeySet).toBe(false);
    // backup should be null when no backup provider was saved
    expect(body.data.backup).toBeNull();
  });

  it("backup is null when backup provider is empty", async () => {
    const postRes = await postLlmConfig({
      primary: {
        provider: "anthropic",
        model: "claude-3-opus",
        apiKey: "sk-ant-test",
        endpoint: "",
      },
      backup: {
        provider: "",
        model: "",
        apiKey: "",
        endpoint: "",
      },
    });
    expect(postRes.status).toBe(200);

    const { body } = await getLlmConfig();

    // backup block should be null when provider is empty
    expect(body.data.backup).toBeNull();
    expect(body.data.primary.provider).toBe("anthropic");
    expect(body.data.primary.apiKeySet).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test 2: GET llm-config NEVER leaks raw API keys
   ══════════════════════════════════════════════════════════════════════════ */

describe("GET /settings/llm-config — no raw API key leak", () => {
  it("redacts sensitive values from the legacy per-key endpoint", async () => {
    const credential = "test-credential-redaction";
    const postRes = await postLlmConfig({
      primary: {
        provider: "openai",
        model: "test-model",
        apiKey: credential,
        endpoint: "https://api.openai.com/v1",
      },
    });
    expect(postRes.status).toBe(200);

    const res = await fetch(
      `${baseUrl}/api/v1/settings${projectQ()}&key=synthesis_api_key`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.value).toBe("");
    expect(body.data.isSet).toBe(true);
    expect(JSON.stringify(body)).not.toContain(credential);
  });

  it("does not return the raw API key in the response", async () => {
    const secretKey = "sk-secret123";
    const postRes = await postLlmConfig({
      primary: {
        provider: "openai",
        model: "gpt-4-turbo",
        apiKey: secretKey,
        endpoint: "https://api.openai.com/v1",
      },
    });
    expect(postRes.status).toBe(200);

    const { body } = await getLlmConfig();

    // Serialize to check no raw key exists anywhere in the response
    const json = JSON.stringify(body);
    expect(json).not.toContain(secretKey);

    // The apiKeySet flag should be true
    expect(body.data.primary.apiKeySet).toBe(true);
    // But there should be no apiKey property in the response
    expect(body.data.primary).not.toHaveProperty("apiKey");
    expect(body.data.primary).not.toHaveProperty("api_key");
  });

  it("does not leak backup API key either", async () => {
    const backupSecret = "sk-backup-secret456";
    const postRes = await postLlmConfig({
      primary: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        apiKey: "sk-primary",
        endpoint: "",
      },
      backup: {
        provider: "openai",
        model: "gpt-4o",
        apiKey: backupSecret,
        endpoint: "",
      },
    });
    expect(postRes.status).toBe(200);

    const { body } = await getLlmConfig();
    const json = JSON.stringify(body);

    // Neither primary nor backup raw key should leak
    expect(json).not.toContain("sk-primary");
    expect(json).not.toContain(backupSecret);

    // Flags should indicate keys are set
    expect(body.data.primary.apiKeySet).toBe(true);
    expect(body.data.backup.apiKeySet).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test 3: POST llm-config input validation
   ══════════════════════════════════════════════════════════════════════════ */

describe("POST /settings/llm-config — input validation", () => {
  it("returns 422 when primary.provider is empty", async () => {
    const res = await postLlmConfig({
      primary: { provider: "", model: "gpt-4", apiKey: "" },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("provider");
  });

  it("returns 422 when primary.provider is whitespace", async () => {
    const res = await postLlmConfig({
      primary: { provider: "   ", model: "gpt-4", apiKey: "" },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("provider");
  });

  it("returns 422 when primary.model is empty", async () => {
    const res = await postLlmConfig({
      primary: { provider: "openai", model: "", apiKey: "" },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("model");
  });

  it("returns 422 when primary.model is whitespace", async () => {
    const res = await postLlmConfig({
      primary: { provider: "openai", model: "   ", apiKey: "" },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("model");
  });

  it("returns 422 when primary object is missing entirely", async () => {
    const res = await postLlmConfig({});
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("primary");
  });

  it("returns 422 when primary is not an object", async () => {
    const res = await postLlmConfig({ primary: "not-an-object" });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("primary");
  });

  it("returns 422 when endpoint points to localhost/internal address", async () => {
    const res = await postLlmConfig({
      primary: {
        provider: "openai",
        model: "gpt-4",
        apiKey: "",
        endpoint: "http://localhost:8080/v1",
      },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("internal");
  });

  it("returns 422 when backup endpoint points to private IP", async () => {
    const res = await postLlmConfig({
      primary: {
        provider: "openai",
        model: "gpt-4",
        apiKey: "",
        endpoint: "https://api.openai.com/v1",
      },
      backup: {
        provider: "custom",
        model: "my-model",
        apiKey: "",
        endpoint: "http://192.168.1.1:8080/v1",
      },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("internal");
  });

  it("preserves malformed or empty global config and reports projection failure", async () => {
    const project = projects.getProject(projectName)!;
    const globalProject = projects.getProject("global-default")!;
    for (const originalContent of ["{ malformed config", ""]) {
      configs.saveConfig(globalProject.id, "global", originalContent);

      const res = await postLlmConfig({
        primary: {
          provider: "openai",
          model: "must-not-save",
          endpoint: "https://api.openai.com/v1",
        },
      });

      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("CONFIG_PROJECTION_FAILED");
      expect(configs.getConfig(globalProject.id, "global")?.content).toBe(originalContent);
      expect(settings.getSetting(project.id, "synthesis_model")).not.toBe("must-not-save");
    }
    configs.saveConfig(globalProject.id, "global", "{}");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test 4: GET chat-config returns sanitized data (when configured)
   ══════════════════════════════════════════════════════════════════════════ */

describe("GET /opencode/chat-config — configured state", () => {
  it("returns configured:true with primary info and no raw API keys", async () => {
    // Configure synthesis settings via llm-config endpoint
    const postRes = await postLlmConfig({
      primary: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        apiKey: "sk-dont-leak-me",
        endpoint: "https://api.deepseek.com/v1",
      },
    }, "global-default");
    expect(postRes.status).toBe(200);
    setManagedChatCatalog([{
      id: "deepseek",
      name: "DeepSeek",
      models: ["deepseek-v4-pro"],
      defaultModel: "deepseek-v4-pro",
      roles: ["available", "primary"],
      enabled: true,
    }]);

    const { body } = await getChatConfig();

    expect(body.data.configured).toBe(true);

    // Primary provider info
    expect(body.data.primary).not.toBeNull();
    expect(body.data.primary.providerId).toBe("deepseek");
    expect(body.data.primary.modelId).toBe("deepseek-v4-pro");
    expect(body.data.primary.label).toContain("DeepSeek");
    expect(body.data.primary.label).toContain("deepseek-v4-pro");
    expect(body.data.primary.isCustom).toBe(false);

    // MUST NOT leak the API key
    const json = JSON.stringify(body);
    expect(json).not.toContain("sk-dont-leak-me");
    expect(body.data.primary).not.toHaveProperty("apiKey");
    expect(body.data.primary).not.toHaveProperty("api_key");
    expect(body.data.primary).not.toHaveProperty("apiKeySet");

    // Agents array
    expect(Array.isArray(body.data.agents)).toBe(true);
    expect(body.data.agents.length).toBeGreaterThanOrEqual(1);
    const mainAgent = body.data.agents.find((a: { name: string }) => a.name === "ingenium-chat");
    expect(mainAgent).toBeDefined();
    expect(mainAgent.label).toBe("Ingenium Chat");

    expect(body.data).not.toHaveProperty("restartRequired");
  });

  it("includes backup info when backup is configured", async () => {
    await postLlmConfig({
      primary: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        apiKey: "sk-primary",
        endpoint: "",
      },
      backup: {
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-backup",
        endpoint: "",
      },
    }, "global-default");
    setManagedChatCatalog([
      {
        id: "deepseek",
        name: "DeepSeek",
        models: ["deepseek-v4-pro"],
        defaultModel: "deepseek-v4-pro",
        roles: ["available", "primary"],
        enabled: true,
      },
      {
        id: "openai",
        name: "OpenAI",
        models: ["gpt-4o"],
        defaultModel: "gpt-4o",
        roles: ["available", "backup"],
        enabled: true,
      },
    ]);

    const { body } = await getChatConfig();

    expect(body.data.configured).toBe(true);
    expect(body.data.backup).not.toBeNull();
    expect(body.data.backup.providerId).toBe("openai");
    expect(body.data.backup.modelId).toBe("gpt-4o");
    expect(body.data.backup.isCustom).toBe(false);

    // No key leak
    const json = JSON.stringify(body);
    expect(json).not.toContain("sk-primary");
    expect(json).not.toContain("sk-backup");
  });

  it("does not require a restart after saving provider configuration", async () => {
    const postRes = await postLlmConfig({
      primary: {
        provider: "openai",
        model: "restart-test-model",
        endpoint: "https://api.openai.com/v1",
      },
    }, "global-default");
    expect(postRes.status).toBe(200);

    const { body } = await getChatConfig();
    expect(body.data).not.toHaveProperty("restartRequired");
  });

  it("handles __custom__ provider correctly", async () => {
    await postLlmConfig({
      primary: {
        provider: "__custom__",
        model: "my-custom-model",
        apiKey: "sk-custom",
        endpoint: "https://custom-api.example.com/v1",
      },
    }, "global-default");
    setManagedChatCatalog([{
      id: "ingenium-primary",
      name: "Custom",
      models: ["my-custom-model"],
      defaultModel: "my-custom-model",
      roles: ["available", "primary"],
      enabled: true,
    }]);

    const { body } = await getChatConfig();

    expect(body.data.configured).toBe(true);
    expect(body.data.primary.providerId).toBe("ingenium-primary");
    expect(body.data.primary.modelId).toBe("my-custom-model");
    expect(body.data.primary.isCustom).toBe(true);
    expect(body.data.primary.label).toContain("Custom");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test 5: GET chat-config when unconfigured
   ══════════════════════════════════════════════════════════════════════════ */

describe("GET /opencode/chat-config — unconfigured state", () => {
  let providerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    providerSpy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      error: { code: "NETWORK_ERROR", message: "OpenCode is unreachable" },
    });
  });

  afterEach(() => {
    providerSpy?.mockRestore();
  });

  it("returns OPENCODE_UNAVAILABLE when no synthesis_provider set and OpenCode is unreachable", async () => {
    // Use a fresh project name that has no settings saved
    const freshProjectName = "llm-config-unconfigured";
    projects.createProject(freshProjectName);

    const res = await fetch(`${baseUrl}/api/v1/opencode/chat-config${projectQ(freshProjectName)}`);
    // With no managed providers and OpenCode unreachable, the endpoint returns 503
    // so the frontend can show a "starting up" message instead of "No model available".
    expect(res.status).toBe(503);
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("OPENCODE_UNAVAILABLE");
  });

  it("returns OPENCODE_UNAVAILABLE when only apiKey is set without provider and OpenCode is unreachable", async () => {
    const freshProjectName = "llm-config-partial";
    const proj = projects.createProject(freshProjectName);
    // Set an apiKey but no provider
    settings.setSetting(proj.id, "synthesis_api_key", "sk-orphaned");

    const res = await fetch(`${baseUrl}/api/v1/opencode/chat-config${projectQ(freshProjectName)}`);
    expect(res.status).toBe(503);
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("OPENCODE_UNAVAILABLE");
  });
});

describe("runtime OpenCode providers", () => {
  it("restores validated legacy llm-config selections to the Chat catalog", async () => {
    const legacyProjectName = "llm-config-legacy-catalog-compatibility";
    projects.createProject(legacyProjectName);
    projects.setProjectGlobal(legacyProjectName, true);

    const save = await fetch(`${baseUrl}/api/v1/settings/llm-config${projectQ(legacyProjectName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary: { provider: "openai", model: "gpt-4.1", endpoint: "https://api.openai.com/v1" },
        backup: { provider: "anthropic", model: "claude-sonnet-4-6", endpoint: "https://api.anthropic.com/v1" },
      }),
    });
    expect(save.status).toBe(200);

    const { res, body } = await fetch(
      `${baseUrl}/api/v1/opencode/chat-config${projectQ(legacyProjectName)}`,
    ).then(async (response) => ({ res: response, body: await response.json() }));

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      configured: true,
      primary: {
        providerId: "openai",
        modelId: "gpt-4.1",
        label: "OpenAI: gpt-4.1",
      },
      backup: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        label: "Anthropic: claude-sonnet-4-6",
      },
      providers: [
        {
          providerId: "openai",
          models: [{ id: "gpt-4.1", label: "gpt-4.1" }],
        },
        {
          providerId: "anthropic",
          models: [{ id: "claude-sonnet-4-6", label: "claude-sonnet-4-6" }],
        },
      ],
      defaultSelection: { providerId: "openai", modelId: "gpt-4.1" },
    });
  });

  it("returns sanitized free builtin models only", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    const providerSpy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(runtimeProviderList());

    const { res, body } = await getBuiltinProviders();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      providerId: "opencode",
      providerName: "OpenCode Zen",
      models: [{ id: "big-pickle", name: "Big Pickle", providerID: "opencode" }],
      defaultModel: "big-pickle",
      source: "runtime",
    });
    expect(JSON.stringify(body)).not.toContain("apiKey");
    expect(JSON.stringify(body)).not.toContain("public");
    expect(JSON.stringify(body)).not.toContain("options");
    expect(JSON.stringify(body)).not.toContain("env");

    providerSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("returns an unavailable empty result when OpenCode cannot be reached", async () => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-pass");
    const providerSpy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      error: { code: "NETWORK_ERROR", message: "OpenCode is unavailable" },
    });

    const { res, body } = await getBuiltinProviders();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ models: [], defaultModel: null, source: "unavailable" });

    providerSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("returns managed and builtin providers without exposing provider secrets or topology", async () => {
    const managedProject = projects.createProject("llm-config-managed-runtime");
    projects.setProjectGlobal(managedProject.name, true);
    settings.setSetting(managedProject.id, "llm_provider_configs", JSON.stringify([{
      id: "managed-primary",
      name: "Managed Primary",
      npm: "@internal/provider-package",
      baseURL: "http://127.0.0.1:11434/private-provider",
      endpoint: "http://internal.example.invalid/never-expose",
      models: ["managed-model"],
      defaultModel: "managed-model",
      roles: ["available", "primary"],
      enabled: true,
      apiKey: "managed-api-key-must-not-leak",
      headers: { authorization: "Bearer managed-header-token" },
    }]));
    settings.setSetting(managedProject.id, "synthesis_endpoint", "http://127.0.0.1:9999/synthesis-internal");
    const providerSpy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(runtimeProviderList());

    const res = await fetch(`${baseUrl}/api/v1/opencode/chat-config${projectQ("llm-config-managed-runtime")}`);
    const body = await res.json();

    expect(body.data.providers).toEqual([
      {
        providerId: "managed-primary",
        label: "Managed Primary",
        models: [{ id: "managed-model", label: "managed-model" }],
        defaultModel: "managed-model",
        source: "managed",
      },
      {
        providerId: "opencode",
        label: "OpenCode Zen",
        models: [{ id: "big-pickle", label: "Big Pickle" }],
        defaultModel: "big-pickle",
        source: "builtin",
      },
    ]);
    expect(body.data.defaultSelection).toEqual({ providerId: "managed-primary", modelId: "managed-model" });
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "managed-api-key-must-not-leak",
      "managed-header-token",
      "127.0.0.1:11434",
      "127.0.0.1:9999",
      "internal.example.invalid",
      "@internal/provider-package",
      "synthesis_endpoint",
      "baseURL",
      "endpoint",
      "apiKey",
      "headers",
      "authorization",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    providerSpy.mockRestore();
  });

  it("uses the OpenCode runtime default when no managed provider is available", async () => {
    const builtinOnlyProject = "llm-config-builtin-runtime";
    projects.createProject(builtinOnlyProject);
    projects.setProjectGlobal(builtinOnlyProject, true);
    const providerSpy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(runtimeProviderList());

    const res = await fetch(`${baseUrl}/api/v1/opencode/chat-config${projectQ(builtinOnlyProject)}`);
    const body = await res.json();

    expect(body.data.defaultSelection).toEqual({ providerId: "opencode", modelId: "big-pickle" });
    providerSpy.mockRestore();
  });

  it("omits arbitrary legacy synthesis settings from the browser DTO", async () => {
    const legacyOnlyProject = "llm-config-legacy-chat-omit";
    const project = projects.createProject(legacyOnlyProject);
    projects.setProjectGlobal(project.name, true);
    settings.setSetting(project.id, "synthesis_provider", "untrusted-provider");
    settings.setSetting(project.id, "synthesis_model", "untrusted-model");
    settings.setSetting(project.id, "synthesis_backup_provider", "untrusted-backup");
    settings.setSetting(project.id, "synthesis_backup_model", "untrusted-backup-model");
    const providerSpy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(runtimeProviderList());

    const res = await fetch(`${baseUrl}/api/v1/opencode/chat-config${projectQ(legacyOnlyProject)}`);
    const body = await res.json();

    expect(body.data).toMatchObject({ configured: false, primary: null, backup: null });
    const serialized = JSON.stringify(body);
    for (const value of ["untrusted-provider", "untrusted-model", "untrusted-backup", "untrusted-backup-model"]) {
      expect(serialized).not.toContain(value);
    }
    providerSpy.mockRestore();
  });

  it("projects legacy selections only when the exact pair exists in the current catalog", async () => {
    const managedProject = "llm-config-legacy-chat-allowed";
    const project = projects.createProject(managedProject);
    projects.setProjectGlobal(project.name, true);
    setManagedChatCatalog([{
      id: "managed-provider",
      name: "Managed Provider",
      models: ["allowed-model"],
      defaultModel: "allowed-model",
      roles: ["available", "primary"],
      enabled: true,
    }], managedProject);
    settings.setSetting(project.id, "synthesis_provider", "managed-provider");
    settings.setSetting(project.id, "synthesis_model", "allowed-model");
    settings.setSetting(project.id, "synthesis_backup_provider", "managed-provider");
    settings.setSetting(project.id, "synthesis_backup_model", "not-allowed");
    const providerSpy = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(runtimeProviderList());

    const res = await fetch(`${baseUrl}/api/v1/opencode/chat-config${projectQ(managedProject)}`);
    const body = await res.json();

    expect(body.data).toMatchObject({
      configured: true,
      primary: {
        providerId: "managed-provider",
        modelId: "allowed-model",
        label: "Managed Provider: allowed-model",
      },
      backup: null,
    });
    providerSpy.mockRestore();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Test 6: POST /test-llm requires project context
   ══════════════════════════════════════════════════════════════════════════ */

describe("POST /settings/test-llm — requires project context", () => {
  it("returns 400 when no project query parameter", async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/test-llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://api.example.com/v1", model: "gpt-4" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("project");
  });

  it("returns 422 when endpoint and model are missing (with valid project)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/test-llm${projectQ()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("endpoint");
  });

  it("returns 422 when only endpoint is missing (with valid project)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/test-llm${projectQ()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("endpoint");
  });

  it("uses the same internal endpoint guard as config save", async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/test-llm${projectQ()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "http://127.0.0.1:4097/v1", model: "test-model" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.message).toContain("internal/private");
  });

  it("returns a sanitized transport failure without reflecting the endpoint", async () => {
    // A public literal IP bypasses resolver timing, so this test exercises the
    // transport-error branch rather than turning a DNS retry into a flaky test.
    const endpoint = "https://1.1.1.1/v1";
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.startsWith(endpoint)) {
        return Promise.reject(new TypeError("mocked transport failure"));
      }
      return nativeFetch(input, init);
    });
    try {
      const res = await fetch(`${baseUrl}/api/v1/settings/test-llm${projectQ()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, model: "test-model" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({ ok: false, status: 0, message: "Unable to reach LLM endpoint" });
      expect(JSON.stringify(body)).not.toContain(endpoint);
    } finally {
      transport.mockRestore();
    }
  });
});
