import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const transportParityVerifier = join(extensionRoot, "scripts", "verify-mcp-transport-parity.mjs");
const packagedContextTool = join(extensionRoot, "dist", "lib", "tools", "context.js");
const currentSessionImportArtifact = join(extensionRoot, "dist", "context-import.js");

describe("packaged MCP transport parity", () => {
  it("matches current server registrations and the canonical catalog", () => {
    const result = spawnSync(process.execPath, [transportParityVerifier], {
      cwd: extensionRoot,
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("MCP transport parity verified");
    expect(result.stdout).toContain("ingenium_context_opencode_session_import");
    expect(result.stdout).toContain("ingenium_context_import_current_session");
  });

  it("ships the optional bounded session-import limit and current-session tool artifact", async () => {
    expect(existsSync(packagedContextTool)).toBe(true);
    expect(existsSync(currentSessionImportArtifact)).toBe(true);

    const schemaCheck = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `const contextTools = await import(process.argv[1]);
       const schema = contextTools.createOpenCodeSessionImportInputSchema("parity-project");
       const common = { project: "parity-project", sessionId: "session-parity-001", directory: "/workspaces/parity-project" };
       const omitted = schema.safeParse(common);
       if (!omitted.success || omitted.data.limit !== undefined
         || !schema.safeParse({ ...common, limit: 1 }).success
         || !schema.safeParse({ ...common, limit: 100 }).success
         || schema.safeParse({ ...common, limit: 0 }).success
         || schema.safeParse({ ...common, limit: 101 }).success) {
         throw new Error("Packaged optional session-import limit schema is invalid");
       }
       console.log("Packaged optional session-import limit schema verified");`,
      pathToFileURL(packagedContextTool).href,
    ], {
      cwd: extensionRoot,
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(schemaCheck.error, `${schemaCheck.stdout}\n${schemaCheck.stderr}`).toBeUndefined();
    expect(schemaCheck.status, `${schemaCheck.stdout}\n${schemaCheck.stderr}`).toBe(0);
    expect(schemaCheck.stdout).toContain("Packaged optional session-import limit schema verified");
  });
});
