import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MCP_TOOL_CATALOG } from "../../../packages/ingenium-core/lib/tools/mcp-tool-catalog.js";
import { childMcpAuthorizationPolicy, explicitMcpAuthorizationPolicy } from "../../../packages/ingenium-core/lib/tools/mcp-authorization-policy.js";
import { policyForRequest } from "../../ingenium-api/lib/authorization-policy.js";

const serverSource = readFileSync(fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url)), "utf8");

describe("AUTH-102 MCP policy parity", () => {
  it("declares authorization for every registered tool", () => {
    const registered = [...serverSource.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map((match) => `ingenium_${match[1]}`);
    const policyByName = new Map(MCP_TOOL_CATALOG.map((tool) => [tool.name, tool.authorization]));
    expect(registered).toHaveLength(280);
    expect(registered.filter((name) => !policyByName.get(name))).toEqual([]);
    expect(MCP_TOOL_CATALOG.filter((tool) => !tool.authorization || tool.authorization.scopes.length === 0)).toEqual([]);
    for (const tool of MCP_TOOL_CATALOG) expect(tool.authorization).toEqual(explicitMcpAuthorizationPolicy(tool.name, tool.category));
    expect(() => explicitMcpAuthorizationPolicy("ingenium_unregistered_operation", "Unknown")).toThrow("Missing explicit MCP authorization policy");
    expect(childMcpAuthorizationPolicy()).toEqual({
      action: "child-mcp.execute",
      resource: "child-mcp",
      permission: "execute",
      target: "project",
      scopes: ["child-mcp:execute"],
      launcherBinding: "required",
    });
  });

  it("maps every declared tool endpoint to REST policy and preserves homogeneous targets", () => {
    const drift: string[] = [];
    for (const tool of MCP_TOOL_CATALOG) {
      const policy = tool.authorization!;
      const targets = new Set<string>();
      for (const endpoint of tool.apiEndpoints) {
        const separator = endpoint.indexOf(" ");
        const rest = policyForRequest({ method: endpoint.slice(0, separator), path: endpoint.slice(separator + 1) } as never);
        if (!rest) drift.push(`${tool.name}: ${endpoint}`);
        else targets.add(rest.target);
      }
      if (targets.size === 1 && !targets.has(policy.target)) drift.push(`${tool.name}: target ${policy.target} != ${[...targets][0]}`);
    }
    expect(drift).toEqual([]);
  });

  it("corrects security-relevant route/catalog scope drift", () => {
    const byName = new Map(MCP_TOOL_CATALOG.map((tool) => [tool.name, tool]));
    expect(byName.get("ingenium_backup_create")?.authorization?.target).toBe("installation");
    expect(byName.get("ingenium_docs_get_page")?.authorization?.target).toBe("organization");
    expect(byName.get("ingenium_synthesis_cross_project")?.projectScope).toBe("global");
    expect(byName.get("ingenium_coordination_status")?.apiEndpoints).toEqual(["GET /api/v1/coordination/snapshot"]);
    expect(byName.get("ingenium_context_message_retrieve")?.authorization?.target).toBe("private");
    expect(byName.get("ingenium_project_init")?.authorization?.target).toBe("organization");
  });
});
