import { describe, expect, it } from "vitest";
import { hasActiveRuntimeForRestore } from "../lib/restore-runtime-guard.js";

describe("AUTH-108 restore isolation", () => {
  it("refuses restore for every non-terminal runtime state", () => {
    expect(hasActiveRuntimeForRestore([
      { state: "ABSENT" },
      { state: "STOPPED" },
      { state: "FAILED" },
      { state: "REVOKED" },
    ])).toBe(false);
    expect(hasActiveRuntimeForRestore([{ state: "PROVISIONING" }])).toBe(true);
    expect(hasActiveRuntimeForRestore([{ state: "STARTING" }])).toBe(true);
    expect(hasActiveRuntimeForRestore([{ state: "READY" }])).toBe(true);
    expect(hasActiveRuntimeForRestore([{ state: "IDLE" }])).toBe(true);
    expect(hasActiveRuntimeForRestore([{ state: "STOPPING" }])).toBe(true);
  });
});
