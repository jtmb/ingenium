import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const originalToken = process.env.INGENIUM_API_TOKEN;
const originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;

afterEach(() => {
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Ingenium API client authentication", () => {
  it("adds the configured bearer credential to API requests", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    await api.get("/health");

    const requestHeaders = new Headers(fetchMock.mock.calls[0]![1].headers);
    expect(requestHeaders.get("Authorization")).toBe("Bearer test-server-token");
    expect(requestHeaders.get("Content-Type")).toBe("application/json");
  });

  it("does not synthesize an Authorization header when the API token is absent", async () => {
    delete process.env.INGENIUM_API_TOKEN;
    process.env.INGENIUM_API_TOKEN_FILE = ".opencode/not-a-token-file";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    await api.get("/health");

    expect(new Headers(fetchMock.mock.calls[0]![1].headers).has("Authorization")).toBe(false);
  });

  it("resolves the protected OpenCode token file supplied to the env-cleared child process", async () => {
    const originalCwd = process.cwd();
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-server-auth-"));
    const opencodeDir = join(worktree, ".opencode");
    mkdirSync(opencodeDir);
    const tokenPath = join(opencodeDir, ".ingenium-api-token");
    writeFileSync(tokenPath, "test-file-token\n", { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    process.chdir(worktree);
    delete process.env.INGENIUM_API_TOKEN;
    process.env.INGENIUM_API_TOKEN_FILE = ".opencode/.ingenium-api-token";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { api } = await import("../lib/client.js");
      await api.get("/health");

      expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("Authorization")).toBe("Bearer test-file-token");
    } finally {
      process.chdir(originalCwd);
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});
