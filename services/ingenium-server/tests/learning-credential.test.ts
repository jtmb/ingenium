import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiRequestHeaders } from "../config/index.js";

const originalEnvironment = { ...process.env };
let directory = "";

afterEach(() => {
  process.env = { ...originalEnvironment };
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

describe("learning MCP credential", () => {
  it("rejects legacy inline content without falling back to a valid file", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-inline-credential-"));
    chmodSync(directory, 0o700);
    const credential = join(directory, ".ingenium-mcp-credential");
    writeFileSync(credential, `${"g".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(credential, 0o600);
    const sentinel = "sentinel_credential_content_123456";
    process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = "general";
    process.env.INGENIUM_MCP_AUDIENCE = "mcp";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = credential;
    process.env.INGENIUM_MCP_CREDENTIAL = sentinel;

    const headers = apiRequestHeaders();
    expect(headers.has("Authorization")).toBe(false);
    expect(JSON.stringify([...headers])).not.toContain(sentinel);
  });

  it("accepts the fixed general MCP file from an owner-private absolute directory", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-general-credential-"));
    chmodSync(directory, 0o700);
    const credential = join(directory, ".ingenium-mcp-credential");
    writeFileSync(credential, `${"g".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(credential, 0o600);
    process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = "general";
    process.env.INGENIUM_MCP_AUDIENCE = "mcp";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = credential;

    expect(apiRequestHeaders().get("Authorization")).toBe(`Bearer ${"g".repeat(32)}`);

    chmodSync(directory, 0o750);
    expect(apiRequestHeaders().has("Authorization")).toBe(false);
  });

  it("accepts only the fixed learning file from an owner-private absolute directory", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-learning-credential-"));
    chmodSync(directory, 0o700);
    const credential = join(directory, ".ingenium-learning-credential");
    writeFileSync(credential, `${"l".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(credential, 0o600);
    process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = "learning";
    process.env.INGENIUM_MCP_AUDIENCE = "mcp";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = credential;

    expect(apiRequestHeaders().get("Authorization")).toBe(`Bearer ${"l".repeat(32)}`);

    chmodSync(directory, 0o750);
    expect(apiRequestHeaders().has("Authorization")).toBe(false);
  });

  it("rejects a learning credential under the repository-sync audience", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-learning-audience-"));
    chmodSync(directory, 0o700);
    const credential = join(directory, ".ingenium-learning-credential");
    writeFileSync(credential, `${"l".repeat(32)}\n`, { mode: 0o600 });
    process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = "learning";
    process.env.INGENIUM_MCP_AUDIENCE = "repository-sync";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = credential;

    expect(apiRequestHeaders().has("Authorization")).toBe(false);
  });
});
