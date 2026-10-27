import { beforeEach, describe, expect, it, vi } from "vitest";
const upstream = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../lib/opencode-client.js", () => ({
  opencodeClient: { listProviders: upstream.list },
  isOpenCodeError: (value: unknown) => !!value && typeof value === "object" && "error" in value,
}));
import { getNativeJobProviderCatalog, resolveJobProviderModel } from "../lib/job-native-provider.js";

const native = { authentication: "anonymous" as const, connectionId: "job-native:owned", providerKey: "opencode",
  modelId: "beam-free", config: {}, release: vi.fn() };
function catalog(input = 0, output = 0, status = "active") {
  return { all: [{ id: "opencode", name: "Zen", models: {
    "beam-free": { id: "beam-free", name: "Beam Free", status, cost: { input, output }, options: { apiKey: "do-not-expose" } },
    "paid": { id: "paid", status: "active", cost: { input: 1, output: 1 } },
  } }], default: { opencode: "beam-free" } };
}
beforeEach(() => upstream.list.mockReset().mockResolvedValue(catalog()));
describe("Job provider model selection", () => {
  it("validates the current free catalog and projects only scalar model metadata", async () => {
    expect(await resolveJobProviderModel(native)).toBe("opencode/beam-free");
    const result = await getNativeJobProviderCatalog();
    expect(result?.models).toEqual([{ id: "beam-free", label: "Beam Free" }]);
    expect(JSON.stringify(result)).not.toContain("do-not-expose");
    expect(upstream.list).toHaveBeenCalledTimes(2);
  });
  it.each([catalog(1), catalog(0, 1), catalog(0, 0, "deprecated"), { error: { code: "unavailable" } }, {}])(
    "fails closed if the exact model is paid, inactive or unavailable", async (value) => {
      upstream.list.mockResolvedValue(value);
      await expect(resolveJobProviderModel(native)).rejects.toThrow("unavailable");
    },
  );
  it("rejects another native provider identity and another model", async () => {
    await expect(resolveJobProviderModel({ ...native, providerKey: "openai" })).rejects.toThrow("unavailable");
    await expect(resolveJobProviderModel({ ...native, modelId: "missing" })).rejects.toThrow("unavailable");
  });
  it("uses an explicitly granted managed default without loading a native catalog", async () => {
    const managed = { authentication: "api" as const, connectionId: "managed", providerKey: "managed",
      config: { models: ["first", "selected"], defaultModel: "selected" }, credential: Buffer.from("fixture-only"), release: vi.fn() };
    expect(await resolveJobProviderModel(managed)).toBe("managed/selected");
    expect(upstream.list).not.toHaveBeenCalled();
    await expect(resolveJobProviderModel({ ...managed, config: { models: ["first", "selected"] } })).rejects.toThrow();
    await expect(resolveJobProviderModel({ ...managed, config: { models: ["first"], defaultModel: "missing" } })).rejects.toThrow();
    expect(await resolveJobProviderModel({ ...managed, config: { models: ["only"] } })).toBe("managed/only");
  });
});
