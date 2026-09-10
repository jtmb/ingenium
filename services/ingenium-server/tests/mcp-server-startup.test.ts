import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER_SOURCE_PATH = fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url));

describe("MCP server startup", () => {
  it("reconciles built-in visibility before the parent can serve tools/list", () => {
    const source = readFileSync(SERVER_SOURCE_PATH, "utf8");
    const builtInPreparation = source.indexOf("await toolVisibility.prepare()");
    const parentConnect = source.indexOf("await server.connect(transport)");
    const builtInReconcile = source.indexOf("await toolVisibility.start()");
    const childReconcile = source.indexOf("await childGateway.start()");

    expect(builtInPreparation).toBeGreaterThan(-1);
    expect(parentConnect).toBeGreaterThan(-1);
    expect(builtInPreparation).toBeLessThan(parentConnect);
    expect(builtInReconcile).toBeGreaterThan(parentConnect);
    expect(childReconcile).toBeGreaterThan(parentConnect);
  });

  it("uses exact report mode and skips child gateway and redundant visibility side effects", () => {
    const source = readFileSync(SERVER_SOURCE_PATH, "utf8");

    expect(source).toContain('const mcpReportMode = process.env.INGENIUM_MCP_REPORT_MODE === "1";');
    expect(source).toContain("let childGateway: ChildMcpGateway | null = null;");
    expect(source).toContain("if (!mcpReportMode) installToolVisibilityProjection(server, toolVisibility);");
    expect(source).toMatch(/if \(!mcpReportMode\) \{\s+if \(!launcherProject\) throw new McpStartupError\("local-binding"\);\s+await toolVisibility\.prepare\(\);/);
    expect(source).toContain("if (!mcpReportMode) await toolVisibility.start();");
    expect(source).toMatch(/"health_check",[\s\S]*?mcpReportMode\s+\? async \(\) => healthCheck\(\)\s+: wrapLauncherScopedHandler/);
    expect(source).toContain('const preflight = await api.settled.get("/auth/preflight");');
    expect(source).toContain('if (preflight.status === 401 || preflight.status === 403) throw new McpStartupError("authentication");');
    expect(source).toContain('if (preflight.status === 404) throw new McpStartupError("project-preflight");');
    expect(source).toContain('if (preflight.status === 429) throw new McpStartupError("transport", "rate_limited");');
    expect(source).toContain('if (!preflight.ok) throw new McpStartupError("transport");');
    expect(source).toContain('if (!launcherProject) throw new McpStartupError("local-binding");');
    expect(source).toContain('logger.fatal({ boundary: "parent-mcp-startup", stage, reason }, "Fatal error in MCP server");');
    expect(source).toContain("binding,");
    expect(source).toContain("if (childGateway) await childGateway.start();");
    expect(source).toContain("if (childGateway) await childGateway.shutdown();");
  });

  it("registers the report through the normal project state gate", () => {
    const source = readFileSync(SERVER_SOURCE_PATH, "utf8");

    expect(source).toMatch(/server\.registerTool\(\s*"mcp_report_get",[\s\S]*?wrapHandler\(C\("mcp_report_get"\)/);
  });

  it("registers repository synchronization once through the launcher-bound state gate", () => {
    const source = readFileSync(SERVER_SOURCE_PATH, "utf8");

    expect(source.match(/server\.registerTool\(\s*"repository_sync"/g)).toHaveLength(1);
    expect(source).toMatch(/"repository_sync",[\s\S]*?docsManifest: repositoryDocsManifestParam,[\s\S]*?wrapLauncherBoundHandler\(C\("repository_sync"\), launcherProject/);
  });
});
