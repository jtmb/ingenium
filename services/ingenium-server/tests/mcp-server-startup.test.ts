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

  it("uses exact report mode and skips child gateway lifecycle side effects", () => {
    const source = readFileSync(SERVER_SOURCE_PATH, "utf8");

    expect(source).toContain('const mcpReportMode = process.env.INGENIUM_MCP_REPORT_MODE === "1";');
    expect(source).toContain("const childGateway = mcpReportMode ? null : new ChildMcpGateway(");
    expect(source).toContain("if (childGateway) await childGateway.start();");
    expect(source).toContain("if (childGateway) await childGateway.shutdown();");
  });

  it("registers the report through the normal project state gate", () => {
    const source = readFileSync(SERVER_SOURCE_PATH, "utf8");

    expect(source).toMatch(/server\.registerTool\(\s*"mcp_report_get",[\s\S]*?wrapHandler\(C\("mcp_report_get"\)/);
  });
});
