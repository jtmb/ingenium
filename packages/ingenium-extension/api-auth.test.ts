import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiRequestHeaders, preflightApiAuthentication } from "./api-auth.js";

let worktree = "";
let originalToken: string | undefined;
let originalTokenFile: string | undefined;

beforeEach(() => {
  originalToken = process.env.INGENIUM_API_TOKEN;
  originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  delete process.env.INGENIUM_API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  worktree = mkdtempSync(join(tmpdir(), "ingenium-api-auth-"));
  mkdirSync(join(worktree, ".opencode"));
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

function writeFallbackToken(value: string, mode: number = 0o600): void {
  const tokenPath = join(worktree, ".opencode", ".ingenium-api-token");
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

  it("prefers the environment credential over the fallback file", () => {
    writeFallbackToken("f".repeat(32));
    process.env.INGENIUM_API_TOKEN = "e".repeat(32);

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${"e".repeat(32)}`);
  });

  it("resolves the tracked file placeholder without treating it as a bearer token", () => {
    const token = "p".repeat(32);
    writeFallbackToken(token);
    process.env.INGENIUM_API_TOKEN = "{file:.opencode/.ingenium-api-token}";

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${token}`);
  });

  it("rejects placeholder paths outside the protected fallback location", () => {
    writeFallbackToken("f".repeat(32));
    process.env.INGENIUM_API_TOKEN = "{file:../outside-token}";

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
    process.env.INGENIUM_API_TOKEN_FILE = tokenPath;

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${token}`);
  });

  it("rejects a symlinked configured token file", () => {
    const targetPath = join(worktree, "target-token");
    const linkedPath = join(worktree, "linked-token");
    writeFileSync(targetPath, `${"a".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, linkedPath);
    process.env.INGENIUM_API_TOKEN_FILE = linkedPath;

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });

  it("returns only a generic preflight failure", async () => {
    writeFallbackToken("f".repeat(32));
    const result = await preflightApiAuthentication("http://127.0.0.1:4097/api/v1", worktree, async () => new Response("internal diagnostic", { status: 403 }));

    expect(result).toEqual({ authenticated: false, error: "Unable to authenticate with Ingenium API" });
  });
});
