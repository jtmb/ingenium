import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest, settings, vault } from "ingenium-core";
import { opencodeClient } from "../lib/opencode-client.js";
import { opencodeRouter } from "../lib/routes/opencode.js";
import {
  recoverServerGlobalProviderMetadata,
  rehydrateServerGlobalProviderConnections,
  storeNativeProviderCredential,
} from "../lib/server-global-provider-persistence.js";

const VAULT_PASSPHRASE = "provider persistence test passphrase";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;
const originalOpenCodePassword = process.env.OPENCODE_SERVER_PASSWORD;
let tempDir = "";
let globalProjectId = "";

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-provider-persistence-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
  process.env.INGENIUM_HOME = join(tempDir, "home");
  process.env.OPENCODE_SERVER_PASSWORD = "provider-persistence-password";
  globalProjectId = projects.createProject("global-default", true).id;
  expect(vault.initializeVault(globalProjectId, VAULT_PASSPHRASE, VAULT_PASSPHRASE).ok).toBe(true);
});

afterEach(() => {
  vault.sealVault();
  resetDbForTest();
  vi.restoreAllMocks();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  globalProjectId = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
  if (originalOpenCodePassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
  else process.env.OPENCODE_SERVER_PASSWORD = originalOpenCodePassword;
});

async function startRouter(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/opencode", opencodeRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

function markProjectAsFormerGlobal(name: string): void {
  expect(projects.setProjectGlobal(name, true)).toBe(true);
  expect(projects.setProjectGlobal("global-default", true)).toBe(true);
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function withRouter<T>(callback: (baseUrl: string) => Promise<T>): Promise<T> {
  const { server, baseUrl } = await startRouter();
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function nativeCredentialId(providerId: string): string | undefined {
  const item = vault.listItems(globalProjectId).find((candidate: any) =>
    candidate.name === `OpenCode Native Provider API Key: ${providerId}`,
  ) as { id: string } | undefined;
  return item?.id;
}

function nativeCredential(providerId: string): string | undefined {
  const itemId = nativeCredentialId(providerId);
  return itemId ? vault.decryptItem(globalProjectId, itemId) ?? undefined : undefined;
}

function openCodeError(code: string, message = "upstream failure"): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function authStatus(providerId: string, connected: boolean): { providers: Array<{
  providerId: string;
  name: string;
  connected: boolean;
  keySet: boolean;
}> } {
  return {
    providers: [{ providerId, name: providerId, connected, keySet: connected }],
  };
}

describe("server-global provider persistence", () => {
  it("moves unambiguous archived former-global provider metadata and vault credentials once without exposing values", () => {
    const stranded = projects.createProject("archived-provider-source");
    const credential = "archived-provider-secret";
    markProjectAsFormerGlobal(stranded.name);
    settings.setSetting(stranded.id, "llm_provider_configs", JSON.stringify([{
      id: "provider-one",
      name: "Provider One",
      models: ["model-one"],
      defaultModel: "model-one",
      enabled: true,
    }]));
    vault.createItem(stranded.id, "Managed LLM API Key: provider-one", "api_key", credential);
    expect(projects.archiveProject("archived-provider-source")).toBe(true);

    const first = recoverServerGlobalProviderMetadata();

    expect(first).toEqual({
      migratedSettings: 1,
      migratedCredentials: 1,
      conflicts: 0,
      skippedForVault: false,
      globalUnavailable: false,
    });
    expect(JSON.stringify(first)).not.toContain(credential);
    expect(settings.getSetting(globalProjectId, "llm_provider_configs")).toContain("provider-one");
    const destination = vault.listItems(globalProjectId).find((item: any) => item.name === "Managed LLM API Key: provider-one") as { id: string } | undefined;
    expect(destination?.id).toBeTruthy();
    expect(vault.decryptItem(globalProjectId, destination!.id)).toBe(credential);
    expect(vault.listItems(stranded.id).some((item: any) => item.name === "Managed LLM API Key: provider-one")).toBe(false);

    expect(recoverServerGlobalProviderMetadata()).toEqual({
      migratedSettings: 0,
      migratedCredentials: 0,
      conflicts: 0,
      skippedForVault: false,
      globalUnavailable: false,
    });
  });

  it("leaves conflicting provider candidates and an existing destination untouched", () => {
    const first = projects.createProject("provider-source-one");
    const second = projects.createProject("provider-source-two");
    markProjectAsFormerGlobal(first.name);
    markProjectAsFormerGlobal(second.name);
    const destination = JSON.stringify([{ id: "destination-provider", enabled: true }]);
    const firstValue = JSON.stringify([{ id: "source-one", enabled: true }]);
    const secondValue = JSON.stringify([{ id: "source-two", enabled: true }]);
    settings.setSetting(globalProjectId, "llm_provider_configs", destination);
    settings.setSetting(first.id, "llm_provider_configs", firstValue);
    settings.setSetting(second.id, "llm_provider_configs", secondValue);

    const result = recoverServerGlobalProviderMetadata();

    expect(result).toMatchObject({ migratedSettings: 0, migratedCredentials: 0, conflicts: 1 });
    expect(JSON.stringify(result)).not.toContain("source-one");
    expect(JSON.stringify(result)).not.toContain("source-two");
    expect(settings.getSetting(globalProjectId, "llm_provider_configs")).toBe(destination);
    expect(settings.getSetting(first.id, "llm_provider_configs")).toBe(firstValue);
    expect(settings.getSetting(second.id, "llm_provider_configs")).toBe(secondValue);
  });

  it("leaves active and archived non-global provider state untouched across startup and unseal recovery", async () => {
    const active = projects.createProject("active-provider-source");
    const archived = projects.createProject("archived-provider-source");
    const activeMetadata = JSON.stringify([{ id: "active-provider", enabled: true }]);
    const archivedMetadata = JSON.stringify([{ id: "archived-provider", enabled: true }]);
    const activeCredential = "active-provider-secret";
    const archivedCredential = "archived-provider-secret";
    settings.setSetting(active.id, "llm_provider_configs", activeMetadata);
    settings.setSetting(archived.id, "llm_provider_configs", archivedMetadata);
    vault.createItem(active.id, "OpenCode Native Provider API Key: active-provider", "api_key", activeCredential);
    vault.createItem(archived.id, "OpenCode Native Provider API Key: archived-provider", "api_key", archivedCredential);
    expect(projects.archiveProject(archived.name)).toBe(true);
    const addAuth = vi.spyOn(opencodeClient, "addAuth").mockResolvedValue({});

    expect(recoverServerGlobalProviderMetadata()).toEqual({
      migratedSettings: 0,
      migratedCredentials: 0,
      conflicts: 0,
      skippedForVault: false,
      globalUnavailable: false,
    });
    expect(await rehydrateServerGlobalProviderConnections()).toEqual({
      restored: 0,
      failed: 0,
      skippedForVault: false,
      globalUnavailable: false,
      nativeOAuth: "unrecoverable_without_durable_credential",
    });
    expect(recoverServerGlobalProviderMetadata()).toEqual({
      migratedSettings: 0,
      migratedCredentials: 0,
      conflicts: 0,
      skippedForVault: false,
      globalUnavailable: false,
    });
    expect(addAuth).not.toHaveBeenCalled();
    expect(settings.getSetting(active.id, "llm_provider_configs")).toBe(activeMetadata);
    expect(settings.getSetting(archived.id, "llm_provider_configs")).toBe(archivedMetadata);
    expect(settings.getSetting(globalProjectId, "llm_provider_configs")).toBeUndefined();
    expect(vault.listItems(active.id).some((item: any) => item.name === "OpenCode Native Provider API Key: active-provider")).toBe(true);
    expect(vault.listItems(archived.id).some((item: any) => item.name === "OpenCode Native Provider API Key: archived-provider")).toBe(true);
  });

  it("persists a native API-key connection through the vault before calling OpenCode", async () => {
    const { server, baseUrl } = await startRouter();
    const secret = "native-provider-secret";
    const addAuth = vi.spyOn(opencodeClient, "addAuth").mockResolvedValue({ connected: true, key: secret });

    try {
      const response = await fetch(`${baseUrl}/api/v1/opencode/auth/openai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "api", key: secret }),
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).not.toContain(secret);
      expect(addAuth).toHaveBeenCalledWith("openai", { type: "api", key: secret }, undefined);
      const stored = vault.listItems(globalProjectId).find((item: any) => item.name === "OpenCode Native Provider API Key: openai") as { id: string } | undefined;
      expect(stored?.id).toBeTruthy();
      expect(vault.decryptItem(globalProjectId, stored!.id)).toBe(secret);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe("native provider credential saga", () => {
    it("persists and redacts integration-key connections", async () => {
      const secret = "integration-provider-secret";
      const connect = vi.spyOn(opencodeClient, "connectIntegrationKey").mockResolvedValue({ key: secret } as never);

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/integrations/openai/connect/key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: secret }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(JSON.parse(body)).toEqual({ data: { connected: true } });
        expect(body).not.toContain(secret);
      });

      expect(connect).toHaveBeenCalledWith("openai", secret);
      expect(nativeCredential("openai")).toBe(secret);
    });

    it("removes a newly stored key after a failed connection and permits a retry", async () => {
      const secret = "retry-provider-secret";
      const connect = vi.spyOn(opencodeClient, "connectIntegrationKey")
        .mockResolvedValueOnce(openCodeError("NETWORK_ERROR", secret) as never)
        .mockResolvedValueOnce({} as never);
      const remove = vi.spyOn(opencodeClient, "deleteAuth").mockResolvedValue({});

      await withRouter(async (baseUrl) => {
        const first = await fetch(`${baseUrl}/api/v1/opencode/integrations/openai/connect/key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: secret }),
        });
        const firstBody = await first.text();
        expect(first.status).toBe(502);
        expect(JSON.parse(firstBody)).toEqual({
          error: { code: "PROVIDER_CONNECTION_FAILED", message: "Provider connection failed" },
        });
        expect(firstBody).not.toContain(secret);
        expect(nativeCredential("openai")).toBeUndefined();

        const retry = await fetch(`${baseUrl}/api/v1/opencode/integrations/openai/connect/key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: secret }),
        });
        expect(retry.status).toBe(200);
      });

      expect(remove).toHaveBeenCalledWith("openai");
      expect(connect).toHaveBeenCalledTimes(2);
      expect(nativeCredential("openai")).toBe(secret);
    });

    it("restores a replaced durable key and OpenCode connection after a failed replacement", async () => {
      const previous = "previous-provider-secret";
      const desired = "desired-provider-secret";
      expect(storeNativeProviderCredential("openai", previous)).toBe("stored");
      const addAuth = vi.spyOn(opencodeClient, "addAuth")
        .mockResolvedValueOnce(openCodeError("NETWORK_ERROR", desired) as never)
        .mockResolvedValueOnce({});

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/auth/openai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: desired }),
        });
        const body = await response.text();

        expect(response.status).toBe(502);
        expect(body).not.toContain(previous);
        expect(body).not.toContain(desired);
      });

      expect(nativeCredential("openai")).toBe(previous);
      expect(addAuth).toHaveBeenNthCalledWith(1, "openai", { type: "api", key: desired }, undefined);
      expect(addAuth).toHaveBeenNthCalledWith(2, "openai", { type: "api", key: previous }, undefined);
    });

    it("keeps the desired durable key recoverable when connection compensation is unknown", async () => {
      const secret = "recoverable-provider-secret";
      vi.spyOn(opencodeClient, "connectIntegrationKey")
        .mockResolvedValue(openCodeError("NETWORK_ERROR", secret) as never);
      vi.spyOn(opencodeClient, "deleteAuth")
        .mockResolvedValue(openCodeError("NETWORK_ERROR", secret));
      vi.spyOn(opencodeClient, "getAuthStatus")
        .mockResolvedValue(openCodeError("NETWORK_ERROR", secret) as never);

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/integrations/openai/connect/key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: secret }),
        });
        const body = await response.text();

        expect(response.status).toBe(502);
        expect(JSON.parse(body)).toEqual({
          error: { code: "PROVIDER_CONNECTION_FAILED", message: "Provider connection failed" },
        });
        expect(body).not.toContain(secret);
      });

      expect(nativeCredential("openai")).toBe(secret);
    });

    it("treats a 404 disconnect as an idempotent absence before deleting the vault key", async () => {
      const secret = "disconnect-not-found-secret";
      expect(storeNativeProviderCredential("openai", secret)).toBe("stored");
      const remove = vi.spyOn(opencodeClient, "deleteAuth")
        .mockResolvedValue(openCodeError("HTTP_404", "not found"));
      const status = vi.spyOn(opencodeClient, "getAuthStatus");

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/auth/openai`, { method: "DELETE" });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: { disconnected: true } });
      });

      expect(remove).toHaveBeenCalledWith("openai", undefined);
      expect(status).not.toHaveBeenCalled();
      expect(nativeCredential("openai")).toBeUndefined();
    });

    it("removes the vault key only after a network-failed disconnect is confirmed absent", async () => {
      const secret = "disconnect-network-absent-secret";
      expect(storeNativeProviderCredential("openai", secret)).toBe("stored");
      vi.spyOn(opencodeClient, "deleteAuth")
        .mockResolvedValue(openCodeError("NETWORK_ERROR", secret));
      const status = vi.spyOn(opencodeClient, "getAuthStatus")
        .mockResolvedValue(authStatus("openai", false));

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/auth/openai?directory=/workspace`, {
          method: "DELETE",
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: { disconnected: true } });
      });

      expect(status).toHaveBeenCalledWith("/workspace");
      expect(nativeCredential("openai")).toBeUndefined();
    });

    it("retains the vault key when a failed disconnect is still connected", async () => {
      const secret = "disconnect-connected-secret";
      expect(storeNativeProviderCredential("openai", secret)).toBe("stored");
      vi.spyOn(opencodeClient, "deleteAuth")
        .mockResolvedValue(openCodeError("NETWORK_ERROR", secret));
      const status = vi.spyOn(opencodeClient, "getAuthStatus")
        .mockResolvedValue(authStatus("openai", true));

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/auth/openai?directory=/workspace`, {
          method: "DELETE",
        });
        const body = await response.text();
        expect(response.status).toBe(502);
        expect(body).not.toContain(secret);
      });

      expect(status).toHaveBeenCalledWith("/workspace");
      expect(nativeCredential("openai")).toBe(secret);
    });

    it("retains the vault key when disconnect status is unknown", async () => {
      const secret = "disconnect-unknown-secret";
      expect(storeNativeProviderCredential("openai", secret)).toBe("stored");
      vi.spyOn(opencodeClient, "deleteAuth")
        .mockResolvedValue(openCodeError("NETWORK_ERROR", secret));
      vi.spyOn(opencodeClient, "getAuthStatus")
        .mockResolvedValue(openCodeError("NETWORK_ERROR", secret) as never);

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/auth/openai`, { method: "DELETE" });
        expect(response.status).toBe(502);
      });

      expect(nativeCredential("openai")).toBe(secret);
    });

    it("re-adds the snapshotted key when vault deletion fails after OpenCode disconnects", async () => {
      const secret = "disconnect-rollback-secret";
      expect(storeNativeProviderCredential("openai", secret)).toBe("stored");
      vi.spyOn(opencodeClient, "deleteAuth").mockResolvedValue({});
      const addAuth = vi.spyOn(opencodeClient, "addAuth").mockResolvedValue({});
      const deleteItem = vi.spyOn(vault, "deleteItem").mockImplementationOnce(() => {
        throw new Error("vault delete failed");
      });

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/auth/openai`, { method: "DELETE" });
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({
          error: { code: "PROVIDER_DISCONNECT_FAILED", message: "Provider disconnect failed" },
        });
      });

      expect(deleteItem).toHaveBeenCalledOnce();
      expect(nativeCredential("openai")).toBe(secret);
      expect(addAuth).toHaveBeenCalledWith("openai", { type: "api", key: secret }, undefined);
    });

    it("rejects sealed and conflicting vault state before changing OpenCode", async () => {
      const addAuth = vi.spyOn(opencodeClient, "addAuth").mockResolvedValue({});
      vault.sealVault();

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/auth/openai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: "sealed-provider-secret" }),
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: {
            code: "VAULT_REQUIRED",
            message: "Unseal and initialize the vault before connecting a provider with an API key.",
          },
        });
      });

      expect(addAuth).not.toHaveBeenCalled();
    });

    it("rejects conflicting native credentials before changing OpenCode", async () => {
      vault.createItem(globalProjectId, "OpenCode Native Provider API Key: openai", "api_key", "first-secret");
      vault.createItem(globalProjectId, "OpenCode Native Provider API Key: openai", "api_key", "second-secret");
      const connect = vi.spyOn(opencodeClient, "connectIntegrationKey").mockResolvedValue({} as never);

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/integrations/openai/connect/key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "desired-secret" }),
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: {
            code: "PROVIDER_CREDENTIAL_CONFLICT",
            message: "A saved provider credential needs operator review before it can be changed.",
          },
        });
      });

      expect(connect).not.toHaveBeenCalled();
    });

    it("serializes same-provider requests while different providers proceed independently", async () => {
      const firstOpenAi = deferred<{}>();
      const anthropic = deferred<{}>();
      const addAuth = vi.spyOn(opencodeClient, "addAuth").mockImplementation((providerId) => {
        if (providerId === "openai") return firstOpenAi.promise;
        return anthropic.promise;
      });

      await withRouter(async (baseUrl) => {
        const first = fetch(`${baseUrl}/api/v1/opencode/auth/openai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: "openai-first-secret" }),
        });
        await vi.waitFor(() => expect(addAuth).toHaveBeenCalledTimes(1));

        const second = fetch(`${baseUrl}/api/v1/opencode/auth/openai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: "openai-second-secret" }),
        });
        const independent = fetch(`${baseUrl}/api/v1/opencode/auth/anthropic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: "anthropic-secret" }),
        });
        await vi.waitFor(() => expect(addAuth).toHaveBeenCalledTimes(2));
        expect(nativeCredential("openai")).toBe("openai-first-secret");

        anthropic.resolve({});
        expect((await independent).status).toBe(200);
        firstOpenAi.resolve({});
        expect((await first).status).toBe(200);
        expect((await second).status).toBe(200);
      });

      expect(addAuth).toHaveBeenNthCalledWith(1, "openai", {
        type: "api",
        key: "openai-first-secret",
      }, undefined);
      expect(addAuth).toHaveBeenNthCalledWith(2, "anthropic", {
        type: "api",
        key: "anthropic-secret",
      }, undefined);
      expect(addAuth).toHaveBeenNthCalledWith(3, "openai", {
        type: "api",
        key: "openai-second-secret",
      }, undefined);
      expect(nativeCredential("openai")).toBe("openai-second-secret");
      expect(nativeCredential("anthropic")).toBe("anthropic-secret");
    });

    it("routes provider status through OpenCode without accessing the vault", async () => {
      const status = vi.spyOn(opencodeClient, "getAuthStatus")
        .mockResolvedValue(authStatus("openai", true));

      await withRouter(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v1/opencode/auth/status?directory=/workspace`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: authStatus("openai", true) });
      });

      expect(status).toHaveBeenCalledWith("/workspace");
      expect(vault.listItems(globalProjectId)).toEqual([]);
    });
  });

  it("rehydrates durable API keys and reports native OAuth as unrecoverable without a credential", async () => {
    const secret = "rehydrate-provider-secret";
    expect(storeNativeProviderCredential("openai", secret)).toBe("stored");
    const addAuth = vi.spyOn(opencodeClient, "addAuth").mockResolvedValue({});

    const result = await rehydrateServerGlobalProviderConnections();

    expect(result).toEqual({
      restored: 1,
      failed: 0,
      skippedForVault: false,
      globalUnavailable: false,
      nativeOAuth: "unrecoverable_without_durable_credential",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(addAuth).toHaveBeenCalledWith("openai", { type: "api", key: secret }, "/workspace");
  });
});
