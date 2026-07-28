import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest, settings } from "ingenium-core";
import { executeSynthesisBroker, opencodeClient } from "../lib/opencode-client.js";

const temporaryPaths: string[] = [];

function configuredProject(primary?: [string, string], secondary?: [string, string]): string {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-synthesis-broker-"));
  temporaryPaths.push(directory);
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "test.db");
  resetDbForTest();
  const project = projects.createProject(`broker-${Date.now()}-${Math.random()}`);
  if (primary) {
    settings.setSetting(project.id, "synthesis_provider", primary[0]);
    settings.setSetting(project.id, "synthesis_model", primary[1]);
  }
  if (secondary) {
    settings.setSetting(project.id, "synthesis_backup_provider", secondary[0]);
    settings.setSetting(project.id, "synthesis_backup_model", secondary[1]);
  }
  const providerConfigs = new Map<string, { id: string; name: string; models: string[]; roles: string[]; enabled: boolean; defaultModel: string }>();
  for (const [providerId, modelId, role] of [
    ...(primary ? [[primary[0], primary[1], "primary"] as const] : []),
    ...(secondary ? [[secondary[0], secondary[1], "backup"] as const] : []),
  ]) {
    const existing = providerConfigs.get(providerId);
    if (existing) {
      if (!existing.models.includes(modelId)) existing.models.push(modelId);
      if (!existing.roles.includes(role)) existing.roles.push(role);
      continue;
    }
    providerConfigs.set(providerId, {
      id: providerId,
      name: providerId,
      models: [modelId],
      defaultModel: modelId,
      roles: ["available", role],
      enabled: true,
    });
  }
  settings.setSetting(project.id, "llm_provider_configs", JSON.stringify([...providerConfigs.values()]));
  return project.id;
}

afterEach(() => {
  resetDbForTest();
  while (temporaryPaths.length) rmSync(temporaryPaths.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({ all: [] });
});

describe("executeSynthesisBroker", () => {
  it("reports an absent selection without executing", async () => {
    const executor = vi.fn();
    const result = await executeSynthesisBroker({ projectId: configuredProject(), system: "system", user: "user", executor });
    expect(result).toEqual({ ok: false, content: "", error: "no synthesis provider configured" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("uses the primary project's configured provider and model", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: true, content: "primary" });
    const result = await executeSynthesisBroker({ projectId: configuredProject(["custom", "model-a"]), system: "system", user: "user", executor });
    expect(result).toEqual({ ok: true, content: "primary" });
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ providerID: "custom", modelID: "model-a", system: "system", user: "user" }));
  });

  it("uses a route-validated explicit selection without silently falling back", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: false, content: "", error: "selected model failed" });
    const result = await executeSynthesisBroker({
      projectId: configuredProject(["primary", "model-a"], ["backup", "model-b"]),
      system: "system",
      user: "user",
      selection: { providerID: "chat-provider", modelID: "chat-model" },
      executor,
    });

    expect(result).toEqual({ ok: false, content: "", error: "selected model failed" });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      providerID: "chat-provider",
      modelID: "chat-model",
    }));
  });

  it("falls back from primary to secondary", async () => {
    const executor = vi.fn()
      .mockResolvedValueOnce({ ok: false, content: "", error: "primary failed" })
      .mockResolvedValueOnce({ ok: true, content: "secondary" });
    const result = await executeSynthesisBroker({ projectId: configuredProject(["custom", "model-a"], ["custom", "model-b"]), system: "system", user: "user", executor });
    expect(result).toEqual({ ok: true, content: "secondary" });
    expect(executor.mock.calls.map(([call]) => [call.providerID, call.modelID])).toEqual([["custom", "model-a"], ["custom", "model-b"]]);
  });

  it("returns a safe failure after both configured providers fail", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: false, content: "", error: "unavailable" });
    const result = await executeSynthesisBroker({ projectId: configuredProject(["one", "a"], ["two", "b"]), system: "system", user: "user", executor });
    expect(result).toEqual({ ok: false, content: "", error: "all configured synthesis providers failed" });
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("suppresses an identical primary and secondary provider-model pair", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: false, content: "", error: "unavailable" });
    await executeSynthesisBroker({ projectId: configuredProject(["custom", "same"], ["custom", "same"]), system: "system", user: "user", executor });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("uses the server-resolved Zen default when no valid managed synthesis pair remains", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: true, content: "zen" });
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      all: [{
        id: "opencode",
        name: "OpenCode Zen",
        models: {
          zen: {
            id: "opencode/zen-free",
            status: "active",
            cost: { input: 0, output: 0 },
          },
        },
      }],
      default: { opencode: "opencode/zen-free" },
    });

    const projectId = configuredProject(["removed-provider", "removed-model"]);
    settings.setSetting(projectId, "llm_provider_configs", "[]");
    const result = await executeSynthesisBroker({
      projectId,
      system: "system",
      user: "user",
      executor,
    });

    expect(result).toEqual({ ok: true, content: "zen" });
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      providerID: "opencode",
      modelID: "opencode/zen-free",
    }));
  });
});
