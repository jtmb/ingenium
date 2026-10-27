import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projects } from "ingenium-core";
import { getChatProviderCatalog } from "../lib/chat-provider-catalog.js";
import { opencodeClient } from "../lib/opencode-client.js";
import { getManualSynthesisModels } from "../lib/manual-synthesis-models.js";

vi.mock("../lib/chat-provider-catalog.js", () => ({ getChatProviderCatalog: vi.fn() }));

const zen = { providerId: "opencode", label: "Zen", models: [{ id: "beam-free", label: "Beam Free" }], defaultModel: "beam-free", source: "builtin" as const };

beforeEach(() => {
  vi.spyOn(projects, "getGlobalProject").mockReturnValue({ id: "global-project" } as ReturnType<typeof projects.getGlobalProject>);
  vi.mocked(getChatProviderCatalog).mockResolvedValue({ providers: [zen], unavailable: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

function nativeCatalog(overrides: Record<string, unknown> = {}) {
  return { all: [{ id: "openai", name: "OpenAI", options: { apiKey: "never-expose-this" }, models: {
    luna: { id: "gpt-6-luna", name: "Luna", status: "active", headers: { Authorization: "never-expose-this" } },
    retired: { id: "retired", status: "deprecated" },
    poisoned: { id: "sk-secret123456789", status: "active" },
  } }], connected: ["openai"], default: {}, ...overrides };
}

describe("manual synthesis model catalog", () => {
  it("adds only connected active native models using a scalar allowlist, retaining the unchanged Chat catalog", async () => {
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(nativeCatalog() as Awaited<ReturnType<typeof opencodeClient.listProviders>>);
    const result = await getManualSynthesisModels("external-project");
    expect(getChatProviderCatalog).toHaveBeenCalledWith("global-project");
    expect(result).toEqual({ unavailable: false, providers: [zen, {
      providerId: "openai", label: "OpenAI", models: [{ id: "gpt-6-luna", label: "Luna" }], defaultModel: "gpt-6-luna", source: "builtin",
    }] });
    expect(JSON.stringify(result)).not.toContain("never-expose-this");
    expect(vi.mocked(getChatProviderCatalog).mock.results[0]).toBeDefined();
    expect(zen.models).toEqual([{ id: "beam-free", label: "Beam Free" }]);
  });

  it("does not admit disconnected providers or replace an existing managed provider with the same ID", async () => {
    const native = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue(nativeCatalog({ connected: [] }) as Awaited<ReturnType<typeof opencodeClient.listProviders>>);
    expect((await getManualSynthesisModels("external-project")).providers).toEqual([zen]);
    const managed = { ...zen, providerId: "openai", source: "managed" as const };
    vi.mocked(getChatProviderCatalog).mockResolvedValue({ providers: [zen, managed], unavailable: null });
    native.mockResolvedValue(nativeCatalog() as Awaited<ReturnType<typeof opencodeClient.listProviders>>);
    expect((await getManualSynthesisModels("external-project")).providers).toEqual([zen, managed]);
  });

  it("fails closed on catalog/transport failures instead of exposing partial native diagnostics", async () => {
    const native = vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({ error: { code: "PRIVATE", message: "never-expose-this" } });
    expect(await getManualSynthesisModels("project")).toEqual({ unavailable: true, providers: [] });
    vi.mocked(getChatProviderCatalog).mockResolvedValue({ providers: [], unavailable: "network" });
    native.mockClear();
    expect(await getManualSynthesisModels("project")).toEqual({ unavailable: true, providers: [] });
    expect(native).not.toHaveBeenCalled();
  });
});
