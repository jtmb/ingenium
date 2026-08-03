import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const transportParityVerifier = join(extensionRoot, "scripts", "verify-mcp-transport-parity.mjs");
const packagedTransport = join(extensionRoot, "dist", "scripts", "mcp-transport.js");

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
    expect(result.stdout).toContain("277 registrations");
    expect(result.stdout).toContain("ingenium_context_upload_file");
    expect(result.stdout).toContain("schema contextUploadFilePathParam");
    expect(result.stdout).toContain("ingenium_mcp_report_get");
    expect(result.stdout).toContain("schema mcpReportFilters");
  });

  it("ships the packaged transport artifact used by the parity verifier", () => {
    expect(existsSync(packagedTransport)).toBe(true);
  });
});
