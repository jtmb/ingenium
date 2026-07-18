import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest, settings } from "ingenium-core";
import { executeSynthesisBroker } from "../lib/opencode-client.js";

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
  return project.id;
}

afterEach(() => {
  resetDbForTest();
  while (temporaryPaths.length) rmSync(temporaryPaths.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
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
});
