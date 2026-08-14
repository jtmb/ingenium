import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiRequestHeaders, preflightApiAuthentication } from "./api-auth.js";

let worktree = "";
let originalToken: string | undefined;
let originalTokenFile: string | undefined;
let originalAudience: string | undefined;

beforeEach(() => {
  originalToken = process.env.INGENIUM_MCP_CREDENTIAL;
  originalTokenFile = process.env.INGENIUM_MCP_CREDENTIAL_FILE;
  originalAudience = process.env.INGENIUM_MCP_AUDIENCE;
  delete process.env.INGENIUM_MCP_CREDENTIAL;
  delete process.env.INGENIUM_MCP_CREDENTIAL_FILE;
  delete process.env.INGENIUM_MCP_AUDIENCE;
  worktree = mkdtempSync(join(tmpdir(), "ingenium-api-auth-"));
  mkdirSync(join(worktree, ".opencode"));
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL;
  else process.env.INGENIUM_MCP_CREDENTIAL = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL_FILE;
  else process.env.INGENIUM_MCP_CREDENTIAL_FILE = originalTokenFile;
  if (originalAudience === undefined) delete process.env.INGENIUM_MCP_AUDIENCE;
  else process.env.INGENIUM_MCP_AUDIENCE = originalAudience;
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

function writeFallbackToken(value: string, mode: number = 0o600): void {
  const tokenPath = join(worktree, ".opencode", ".ingenium-mcp-credential");
  writeFileSync(tokenPath, `${value}\n`, { mode });
  chmodSync(tokenPath, mode);
}

describe("extension API authentication", () => {
  it("uses the protected worktree fallback without exposing it through caller input", () => {
    const token = "f".repeat(32);
    writeFallbackToken(token);

    const headers = apiRequestHeaders(worktree, { "Content-Type": "application/json" });

    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("replaces caller-provided authorization with the protected bearer source", () => {
    const token = "f".repeat(32);
    writeFallbackToken(token);

    const headers = apiRequestHeaders(worktree, {
      Authorization: "Bearer caller-controlled-token",
      "Proxy-Authorization": "Bearer proxy-controlled-token",
    });

    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(headers.has("Proxy-Authorization")).toBe(false);
  });

  it("does not forward a caller-provided authorization header when protected sources are unavailable", () => {
    const headers = apiRequestHeaders(worktree, { Authorization: "Bearer caller-controlled-token" });

    expect(headers.has("Authorization")).toBe(false);
  });

  it("prefers the environment credential over the fallback file", () => {
    writeFallbackToken("f".repeat(32));
    process.env.INGENIUM_MCP_CREDENTIAL = "e".repeat(32);

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${"e".repeat(32)}`);
  });

  it("resolves the tracked file placeholder without treating it as a bearer token", () => {
    const token = "p".repeat(32);
    writeFallbackToken(token);
    process.env.INGENIUM_MCP_CREDENTIAL = "{file:.opencode/.ingenium-mcp-credential}";

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${token}`);
  });

  it("uses a distinct protected file for repository-sync audience credentials", () => {
    const mcpToken = "m".repeat(32);
    const repositoryToken = "r".repeat(32);
    writeFallbackToken(mcpToken);
    const repositoryPath = join(worktree, ".opencode", ".ingenium-repository-sync-credential");
    writeFileSync(repositoryPath, `${repositoryToken}\n`, { mode: 0o600 });
    chmodSync(repositoryPath, 0o600);
    process.env.INGENIUM_MCP_AUDIENCE = "repository-sync";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = ".opencode/.ingenium-repository-sync-credential";

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${repositoryToken}`);
    expect(apiRequestHeaders(worktree).get("X-Ingenium-Audience")).toBe("repository-sync");
  });

  it("rejects placeholder paths outside the protected fallback location", () => {
    writeFallbackToken("f".repeat(32));
    process.env.INGENIUM_MCP_CREDENTIAL = "{file:../outside-token}";

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });

  it("rejects group-readable fallback files", () => {
    writeFallbackToken("f".repeat(32), 0o640);

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });

  it("uses a secure absolute token file configured for the extension", () => {
    const tokenPath = join(worktree, "protected-token");
    const token = "a".repeat(32);
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = tokenPath;

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${token}`);
  });

  it("rejects a symlinked configured token file", () => {
    const targetPath = join(worktree, "target-token");
    const linkedPath = join(worktree, "linked-token");
    writeFileSync(targetPath, `${"a".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, linkedPath);
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = linkedPath;

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });

  it.each([[401, "authentication"], [403, "scope"], [404, "not_found"]] as const)("classifies HTTP %i as a safe failure without exposing request details", async (status, failure) => {
    const token = "f".repeat(32);
    const apiBase = "http://127.0.0.1:4097/api/v1";
    writeFallbackToken(token);
    const result = await preflightApiAuthentication(
      apiBase,
      worktree,
      async () => new Response(`internal diagnostic ${token}`, { status }),
    );

    expect(result).toEqual({
      authenticated: false,
      error: "Unable to authenticate with Ingenium API",
      failure,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(apiBase);
    expect(serialized).not.toContain("internal diagnostic");
  });
});
