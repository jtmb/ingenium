import { expect, it } from "vitest";
import { ChildMcpDiscoveryReportInputSchema } from "../lib/schema.js";

it("rejects oversized MCP discovery collections before validating their elements", () => {
  const tools = new Array(129);
  Object.defineProperty(tools, "0", { get: () => { throw new Error("Oversized collection was traversed"); } });
  const result = ChildMcpDiscoveryReportInputSchema.safeParse({ status: "ready", tools });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "too_big", path: ["tools"], maximum: 128 }),
  ]));
});
