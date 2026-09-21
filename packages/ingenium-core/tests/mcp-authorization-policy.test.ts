import { describe, expect, it } from "vitest";
import { explicitMcpAuthorizationPolicy } from "../lib/tools/mcp-authorization-policy.js";

describe("private memory MCP permissions", () => {
  it.each([
    ["read", "read"], ["list", "read"], ["search", "read"], ["operation_status", "read"],
    ["save", "write"], ["update", "write"], ["forget", "write"],
  ])("requires the proper scope for memory_%s", (operation, permission) => {
    expect(explicitMcpAuthorizationPolicy(`ingenium_memory_${operation}`, "Memory")).toMatchObject({
      target: "private", resource: "memory", permission,
      scopes: [`memory:${permission}`], launcherBinding: "required",
    });
  });
});
