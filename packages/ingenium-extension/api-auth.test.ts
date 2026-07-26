import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiRequestHeaders } from "./api-auth.js";

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
    writeFallbackToken("test-fallback-token");

    const headers = apiRequestHeaders(worktree, { "Content-Type": "application/json" });

    expect(headers.get("Authorization")).toBe("Bearer test-fallback-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("prefers the environment credential over the fallback file", () => {
    writeFallbackToken("test-fallback-token");
    process.env.INGENIUM_API_TOKEN = "test-environment-token";

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe("Bearer test-environment-token");
  });

  it("resolves the tracked file placeholder without treating it as a bearer token", () => {
    writeFallbackToken("test-placeholder-token");
    process.env.INGENIUM_API_TOKEN = "{file:.opencode/.ingenium-api-token}";

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe("Bearer test-placeholder-token");
  });

  it("rejects placeholder paths outside the protected fallback location", () => {
    writeFallbackToken("test-fallback-token");
    process.env.INGENIUM_API_TOKEN = "{file:../outside-token}";

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });

  it("rejects group-readable fallback files", () => {
    writeFallbackToken("test-fallback-token", 0o640);

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });
});
