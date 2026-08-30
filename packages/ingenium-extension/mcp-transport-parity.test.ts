import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const transportParityVerifier = join(extensionRoot, "scripts", "verify-mcp-transport-parity.mjs");
const packagedTransport = join(extensionRoot, "dist", "scripts", "mcp-transport.js");
const serverTransport = join(extensionRoot, "..", "..", "services", "ingenium-server", "scripts", "mcp-server.ts");
const catalogSource = join(extensionRoot, "..", "ingenium-core", "lib", "tools", "mcp-tool-catalog.ts");
const healthDescription = "API health check — returns status and uptime. No project param needed.";

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
    expect(result.stdout).toContain("281 registrations");
    expect(result.stdout).toContain("ingenium_context_upload_file");
    expect(result.stdout).toContain("schema contextUploadFilePathParam");
    expect(result.stdout).toContain("ingenium_mcp_report_get");
    expect(result.stdout).toContain("schema mcpReportFilters");
    expect(result.stdout).toContain("ingenium_repository_sync");
    expect(result.stdout).toContain("schema repositoryDocsManifestParam");
  });

  it("ships the packaged transport artifact used by the parity verifier", () => {
    expect(existsSync(packagedTransport)).toBe(true);
  });

  it("keeps health registration metadata aligned with the canonical catalog", () => {
    const registrationDescription = (source: string) => source.match(/["']health_check["']\s*,\s*\{\s*description:\s*["']([^"']+)["']/)?.[1];
    const canonicalDescription = readFileSync(catalogSource, "utf8")
      .match(/name:\s*["']ingenium_health_check["'][\s\S]*?description:\s*["']([^"']+)["']/)?.[1];

    expect({
      canonical: canonicalDescription,
      source: registrationDescription(readFileSync(serverTransport, "utf8")),
      packaged: registrationDescription(readFileSync(packagedTransport, "utf8")),
    }).toEqual({ canonical: healthDescription, source: healthDescription, packaged: healthDescription });
  });
});
