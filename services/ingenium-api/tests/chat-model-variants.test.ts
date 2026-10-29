import { describe, expect, it } from "vitest";
import { chatModelVariants } from "../lib/chat-model-variants.js";
describe("runtime reasoning metadata", () => {
  it("normalizes native v2 arrays and retains only supported identifiers and safe effort scalars", () => {
    expect(chatModelVariants([
      { id: "high", settings: { reasoningEffort: "high", apiKey: "never-expose", headers: { Authorization: "never-expose" } } },
      { id: "none", settings: {} },
      { id: "unsafe effort", settings: {} },
      { id: "secret-token", settings: {} },
      null,
    ])).toEqual({ high: { reasoningEffort: "high" }, none: {} });
  });
  it("accepts retained variant records and rejects malformed metadata without inventing efforts", () => {
    expect(chatModelVariants({ high: { reasoningEffort: "high", baseURL: "private" } })).toEqual({ high: { reasoningEffort: "high" } });
    expect(chatModelVariants(null)).toEqual({});
    expect(chatModelVariants("high")).toEqual({});
  });
});
