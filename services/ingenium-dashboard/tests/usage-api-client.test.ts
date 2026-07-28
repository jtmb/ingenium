import { describe, expect, it } from "vitest";
import { usageQueryParams } from "../src/lib/api";

describe("usage API client query serialization", () => {
  it("preserves raw provider, model, agent, and status filters in repeated query parameters", () => {
    const params = usageQueryParams("external project", {
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-02T00:00:00.000Z",
      providerIds: ["=raw/provider", "Provider Exact"],
      modelIds: ["model:alpha"],
      agentIds: ["agent/exact"],
      statuses: ["partial", "error"],
    }, { limit: 100 });

    expect(params.get("project")).toBe("external project");
    expect(params.getAll("provider")).toEqual(["=raw/provider", "Provider Exact"]);
    expect(params.getAll("model")).toEqual(["model:alpha"]);
    expect(params.getAll("agent")).toEqual(["agent/exact"]);
    expect(params.getAll("status")).toEqual(["partial", "error"]);
    expect(params.get("limit")).toBe("100");
  });
});
