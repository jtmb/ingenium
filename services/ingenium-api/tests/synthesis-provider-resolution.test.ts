import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest, settings } from "ingenium-core";
import { opencodeClient } from "../lib/opencode-client.js";
import { resolveSynthesisProviderSelections } from "../lib/synthesis-provider-resolution.js";

const temporaryPaths: string[] = [];

function runtimeZenCatalog() {
  return {
    all: [{
      id: "opencode",
      name: "OpenCode Zen",
      models: {
        zen: {
          id: "opencode/zen-free",
          name: "Zen Free",
          status: "active",
          cost: { input: 0, output: 0 },
        },
      },
    }],
    default: { opencode: "opencode/zen-free" },
  };
}

function freshProjects(): { globalId: string; externalId: string } {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-synthesis-resolution-"));
  temporaryPaths.push(directory);
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const global = projects.createProject(`global-${Date.now()}-${Math.random()}`, true);
  const external = projects.createProject(`external-${Date.now()}-${Math.random()}`);
  return { globalId: global.id, externalId: external.id };
}

afterEach(() => {
  resetDbForTest();
  while (temporaryPaths.length) rmSync(temporaryPaths.pop()!, { recursive: true, force: true });
  delete process.env.INGENIUM_CORE_DB_PATH;
  vi.restoreAllMocks();
});

describe("server-owned synthesis provider resolution", () => {
  it("uses valid managed primary and backup pairs before the Chat fallback", async () => {
    const { globalId, externalId } = freshProjects();
    settings.setSetting(globalId, "llm_provider_configs", JSON.stringify([{
      id: "managed-provider",
      name: "Managed Provider",
      models: ["primary-model", "backup-model"],
      defaultModel: "primary-model",
      roles: ["available", "primary", "backup"],
      enabled: true,
    }]));
    settings.setSetting(globalId, "synthesis_provider", "managed-provider");
    settings.setSetting(globalId, "synthesis_model", "primary-model");
    settings.setSetting(globalId, "synthesis_backup_provider", "managed-provider");
    settings.setSetting(globalId, "synthesis_backup_model", "backup-model");
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(runtimeZenCatalog());

    await expect(resolveSynthesisProviderSelections(externalId)).resolves.toEqual({
      selections: [
        { providerID: "managed-provider", modelID: "primary-model" },
        { providerID: "managed-provider", modelID: "backup-model" },
      ],
      catalogUnavailable: false,
    });
  });

  it("falls through from absent or stale managed settings to the runtime Zen default", async () => {
    const { globalId, externalId } = freshProjects();
    settings.setSetting(globalId, "synthesis_provider", "removed-provider");
    settings.setSetting(globalId, "synthesis_model", "removed-model");
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(runtimeZenCatalog());

    await expect(resolveSynthesisProviderSelections(externalId)).resolves.toEqual({
      selections: [{ providerID: "opencode", modelID: "opencode/zen-free" }],
      catalogUnavailable: false,
    });
  });

  it("fails closed when the server cannot resolve the Chat catalog", async () => {
    const { externalId } = freshProjects();
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      error: { code: "NETWORK_ERROR", message: "private upstream detail" },
    });

    await expect(resolveSynthesisProviderSelections(externalId)).resolves.toEqual({
      selections: [],
      catalogUnavailable: true,
    });
  });
});

describe("native synthesis selection", () => {
  it("honors globally selected ChatGPT Luna for external projects independently of the chat default", async () => {
    const { globalId, externalId } = freshProjects();
    settings.setSetting(globalId, "synthesis_provider", "openai");
    settings.setSetting(globalId, "synthesis_model", "gpt-6-luna");
    settings.setSetting(globalId, "chat_selection", JSON.stringify({ providerId: "opencode", modelId: "opencode/zen-free" }));
    const zen = runtimeZenCatalog();
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      ...zen, connected: ["openai"], all: [...zen.all, {
        id: "openai", name: "OpenAI", models: {
          luna: { id: "gpt-6-luna", name: "GPT-6 Luna", status: "active" },
        },
      }],
    });
    const result = await resolveSynthesisProviderSelections(externalId);
    expect(result.selections[0]).toEqual({ providerID: "openai", modelID: "gpt-6-luna" });
  });
});
