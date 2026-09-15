import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MCP_TOOL_CATALOG } from "../../../packages/ingenium-core/lib/tools/mcp-tool-catalog.js";
import { childMcpAuthorizationPolicy, explicitMcpAuthorizationPolicy } from "../../../packages/ingenium-core/lib/tools/mcp-authorization-policy.js";
import { policyForRequest } from "../../ingenium-api/lib/authorization-policy.js";

const serverSource = readFileSync(fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url)), "utf8");

describe("AUTH-102 MCP policy parity", () => {
  it("declares authorization for every registered tool", () => {
    const registered = [...serverSource.matchAll(/(?:server\.registerTool|registerProjectTool)\(\s*"([^"]+)"/g)]
      .map((match) => `ingenium_${match[1]}`);
    const policyByName = new Map(MCP_TOOL_CATALOG.map((tool) => [tool.name, tool.authorization]));
    expect(registered).toHaveLength(MCP_TOOL_CATALOG.filter((tool) => tool.name.startsWith("ingenium_")).length);
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
    const targetMismatches: Array<{ tool: string; endpoints: string[]; rest: unknown[]; mcp: unknown }> = [];
    for (const tool of MCP_TOOL_CATALOG) {
      const policy = tool.authorization!;
      const targets = new Set<string>();
      const restPolicies: unknown[] = [];
      for (const endpoint of tool.apiEndpoints) {
        const separator = endpoint.indexOf(" ");
        const rest = policyForRequest({ method: endpoint.slice(0, separator), path: endpoint.slice(separator + 1) } as never);
        if (!rest) drift.push(`${tool.name}: ${endpoint}`);
        else {
          targets.add(rest.target);
          restPolicies.push(rest);
        }
      }
      if (targets.size === 1 && !targets.has(policy.target)) {
        targetMismatches.push({ tool: tool.name, endpoints: tool.apiEndpoints, rest: restPolicies, mcp: policy });
      }
    }
    expect(drift).toEqual([]);
    expect(targetMismatches).toEqual([{
      tool: "ingenium_health_check",
      endpoints: ["GET /api/v1/health"],
      rest: [{ action: "public.read", resource: "public", permission: "read", target: "public" }],
      mcp: {
        action: "health.read",
        resource: "health",
        permission: "read",
        target: "installation",
        scopes: ["health:read"],
        launcherBinding: "none",
      },
    }]);
  });

  it("corrects security-relevant route/catalog scope drift", () => {
    const byName = new Map(MCP_TOOL_CATALOG.map((tool) => [tool.name, tool]));
    expect(byName.get("ingenium_backup_create")?.authorization?.target).toBe("installation");
    expect(byName.get("ingenium_docs_get_page")?.authorization?.target).toBe("organization");
    expect(byName.get("ingenium_synthesis_cross_project")?.projectScope).toBe("global");
    expect(byName.get("ingenium_coordination_status")?.apiEndpoints).toEqual(["GET /api/v1/coordination/snapshot"]);
    expect(byName.get("ingenium_coordination_status")?.authorization?.scopes).toEqual(["coordination:read"]);
    expect(byName.get("ingenium_coordination_memory_read")?.apiEndpoints).toEqual(["POST /api/v1/coordination/memory/read"]);
    expect(byName.get("ingenium_coordination_memory_read")?.authorization).toMatchObject({
      permission: "read",
      target: "project",
      scopes: ["coordination:read"],
      launcherBinding: "required",
    });
    expect(byName.get("ingenium_coordination_update")?.authorization?.scopes).toEqual(["coordination:write"]);
    expect(byName.get("ingenium_coordination_handoff")?.authorization?.scopes).toEqual(["coordination:write"]);
    expect(byName.get("ingenium_context_message_retrieve")?.authorization?.target).toBe("private");
    expect(byName.get("ingenium_memory_save")?.authorization).toMatchObject({
      permission: "write",
      target: "private",
      scopes: ["memory:write"],
      launcherBinding: "required",
    });
    expect(byName.get("ingenium_memory_list")?.authorization).toMatchObject({
      permission: "read",
      target: "private",
      scopes: ["memory:read"],
      launcherBinding: "required",
    });
    expect(byName.get("ingenium_project_init")?.authorization?.target).toBe("organization");
  });

  it("matches all seven private memory permissions to their REST endpoints", () => {
    const tools = MCP_TOOL_CATALOG.filter((tool) => tool.name.startsWith("ingenium_memory_"));
    expect(tools).toHaveLength(7);
    for (const tool of tools) {
      for (const endpoint of tool.apiEndpoints) {
        const [method, path] = endpoint.split(" ");
        const rest = policyForRequest({ method, path } as never)!;
        expect(tool.authorization).toMatchObject({
          target: "private", resource: rest.resource, permission: rest.permission,
          scopes: [`memory:${rest.permission}`],
        });
      }
    }
  });
});
