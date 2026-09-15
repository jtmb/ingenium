import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defaultMcpServerProjection,
  isPackagedMcpLauncher,
  resolvePackagedMcpLauncher,
} from "../lib/mcp-launcher.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-api-mcp-launcher-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("default Ingenium MCP launcher projection", () => {
  it("resolves the extension package artifact from the API entrypoint", () => {
    expect(resolvePackagedMcpLauncher("file:///repo/services/ingenium-api/dist/scripts/api-server.js")).toBe(
      "/repo/packages/ingenium-extension/dist/scripts/mcp-server.js",
    );
    expect(resolvePackagedMcpLauncher("file:///repo/services/ingenium-api/scripts/api-server.ts")).toBe(
      "/repo/packages/ingenium-extension/dist/scripts/mcp-server.js",
    );
  });

  it("accepts only a regular packaged launcher artifact", () => {
    const directory = temporaryDirectory();
    const artifact = join(directory, "mcp-server.js");
    const link = join(directory, "mcp-server-link.js");
    writeFileSync(artifact, "export {};\n", { mode: 0o500 });
    chmodSync(artifact, 0o500);
    symlinkSync(artifact, link);

    expect(isPackagedMcpLauncher(artifact)).toBe(true);
    expect(isPackagedMcpLauncher(link)).toBe(false);
    expect(isPackagedMcpLauncher(join(directory, "missing.js"))).toBe(false);
  });

  it("projects one global Docker session without persisting a bearer token", () => {
    const projection = defaultMcpServerProjection("/app/packages/ingenium-extension/dist/scripts/mcp-server.js");

    expect(projection.command).toBe("node /app/packages/ingenium-extension/dist/scripts/mcp-server.js");
    expect(projection.args).toBe("[]");
    expect(JSON.parse(projection.environment)).toEqual({
      INGENIUM_API_URL: "http://localhost:4097/api/v1",
      INGENIUM_API_TIMEOUT: "10000",
      INGENIUM_PROJECT: "global-default",
    });
    expect(projection.environment).not.toContain("TOKEN");
  });
});
