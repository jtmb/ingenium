import { describe, expect, it } from "vitest";
import { explicitMcpAuthorizationPolicy } from "../lib/tools/mcp-authorization-policy.js";

describe("learning MCP least-privilege policy", () => {
  it("uses exactly the scopes required by extension learning operations", () => {
    const policies = [
      explicitMcpAuthorizationPolicy("auto_observe_now", "Extraction"),
      explicitMcpAuthorizationPolicy("ingenium_extraction_run", "Extraction"),
      explicitMcpAuthorizationPolicy("synthesize_observations", "Synthesis"),
      explicitMcpAuthorizationPolicy("ingenium_synthesis_run", "Synthesis"),
      explicitMcpAuthorizationPolicy("ingenium_pipeline_event_log", "Pipeline"),
      explicitMcpAuthorizationPolicy("ingenium_observe", "Observe"),
    ];

    expect(new Set(policies.flatMap((policy) => policy.scopes))).toEqual(new Set([
      "extraction:write",
      "extraction:execute",
      "synthesis:write",
      "synthesis:execute",
      "pipeline:write",
      "observe:write",
    ]));
    expect(policies.every((policy) => policy.launcherBinding === "required")).toBe(true);
    expect(JSON.stringify(policies)).not.toMatch(/admin|private|vault|runtime|projects:write/);
  });
});
