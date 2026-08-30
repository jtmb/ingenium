import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiRequestHeaders, preflightApiAuthentication, waitForAuthenticatedApiReadiness } from "./api-auth.js";

let worktree = "";

beforeEach(() => {
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL_FILE", undefined);
  vi.stubEnv("INGENIUM_MCP_AUDIENCE", undefined);
  vi.stubEnv("INGENIUM_API_URL", undefined);
  vi.stubEnv("INGENIUM_TRUSTED_API_URL", undefined);
  vi.stubEnv("INGENIUM_MCP_CREDENTIAL_PURPOSE", undefined);
  vi.stubEnv("INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE", undefined);
  vi.stubEnv("INGENIUM_LEARNING_CREDENTIAL_FILE", undefined);
  vi.stubEnv("INGENIUM_PROJECT", "api-auth-project");
  vi.stubEnv("INGENIUM_WORKSPACE_ID", "api-auth-workspace");
  worktree = mkdtempSync(join(tmpdir(), "ingenium-api-auth-"));
  mkdirSync(join(worktree, ".opencode"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

function writeFallbackToken(value: string, mode: number = 0o600): void {
  const tokenPath = join(worktree, ".opencode", ".ingenium-mcp-credential");
  writeFileSync(tokenPath, `${value}\n`, { mode });
  chmodSync(tokenPath, mode);
}

function writePurposeToken(name: string, value: string): void {
  const path = join(worktree, ".opencode", name);
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function writeConfig(apiUrl: string): void {
  writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
    mcp: {
      ingenium: {
        type: "local",
        enabled: true,
        command: ["node", "packages/ingenium-extension/dist/scripts/mcp-server.js"],
        environment: {
          INGENIUM_API_URL: apiUrl,
          INGENIUM_PROJECT: "api-auth-project",
          INGENIUM_WORKSPACE_ID: "api-auth-workspace",
          INGENIUM_WORKTREE: worktree,
          INGENIUM_MCP_AUDIENCE: "mcp",
          INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
          INGENIUM_LEARNING_CREDENTIAL_FILE: ".opencode/.ingenium-learning-credential",
          INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE: ".opencode/.ingenium-repository-sync-credential",
        },
      },
    },
  }));
}

function successfulPreflight(audience: "mcp" | "repository-sync" = "mcp"): Response {
  return Response.json({ data: {
    authenticated: true,
    scopes: audience === "repository-sync" ? ["projects:read", "repository:sync"] : ["projects:read"],
    organizationId: "organization-id",
    projectId: "project-id",
    projectIds: ["project-id"],
    audience,
    workspaceId: "api-auth-workspace",
    launcherWorktree: worktree,
    storageMappingHash: "a".repeat(64),
    restartRequiredOnCredentialChange: true,
  } });
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

  it("fails closed when a legacy inline credential is inherited", () => {
    writeFallbackToken("f".repeat(32));
    const sentinel = "sentinel_credential_content_123456";
    process.env.INGENIUM_MCP_CREDENTIAL = sentinel;

    const headers = apiRequestHeaders(worktree);
    expect(headers.has("Authorization")).toBe(false);
    expect(JSON.stringify([...headers])).not.toContain(sentinel);
  });

  it("uses a distinct protected file for repository-sync audience credentials", () => {
    const mcpToken = "m".repeat(32);
    const repositoryToken = "r".repeat(32);
    writeFallbackToken(mcpToken);
    const repositoryPath = join(worktree, ".opencode", ".ingenium-repository-sync-credential");
    writeFileSync(repositoryPath, `${repositoryToken}\n`, { mode: 0o600 });
    chmodSync(repositoryPath, 0o600);
    process.env.INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE = ".opencode/.ingenium-repository-sync-credential";

    expect(apiRequestHeaders(worktree, undefined, { purpose: "repository-sync" }).get("Authorization")).toBe(`Bearer ${repositoryToken}`);
    expect(apiRequestHeaders(worktree, undefined, { purpose: "repository-sync" }).get("X-Ingenium-Audience")).toBe("repository-sync");
  });

  it("preserves repository-sync purpose through readiness retries without credential fallback", async () => {
    const generalToken = "g".repeat(32);
    const learningToken = "l".repeat(32);
    const repositoryToken = "r".repeat(32);
    writeFallbackToken(generalToken);
    writePurposeToken(".ingenium-learning-credential", learningToken);
    writePurposeToken(".ingenium-repository-sync-credential", repositoryToken);
    const calls: Array<{ authorization: string | null; audience: string | null }> = [];
    let attempt = 0;
    const request = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ authorization: headers.get("Authorization"), audience: headers.get("X-Ingenium-Audience") });
      attempt += 1;
      return attempt === 1 ? new Response(null, { status: 503 }) : successfulPreflight("repository-sync");
    };

    const result = await waitForAuthenticatedApiReadiness("http://localhost:4097/api/v1", worktree, {
      attempts: 2,
      retryDelayMs: 0,
      credentialPurpose: "repository-sync",
      request: request as typeof fetch,
    });

    expect(result.authenticated).toBe(true);
    expect(calls).toEqual([
      { authorization: `Bearer ${repositoryToken}`, audience: "repository-sync" },
      { authorization: `Bearer ${repositoryToken}`, audience: "repository-sync" },
    ]);
    expect(JSON.stringify(calls)).not.toContain(generalToken);
    expect(JSON.stringify(calls)).not.toContain(learningToken);
  });

  it("does not fall back to general or learning credentials when repository-sync is absent", () => {
    writeFallbackToken("g".repeat(32));
    writePurposeToken(".ingenium-learning-credential", "l".repeat(32));

    const headers = apiRequestHeaders(worktree, undefined, { purpose: "repository-sync" });

    expect(headers.has("Authorization")).toBe(false);
  });

  it("uses the learning credential only for learning requests", () => {
    const generalToken = "m".repeat(32);
    const learningToken = "l".repeat(32);
    writeFallbackToken(generalToken);
    const learningPath = join(worktree, ".opencode", ".ingenium-learning-credential");
    writeFileSync(learningPath, `${learningToken}\n`, { mode: 0o600 });
    chmodSync(learningPath, 0o600);
    process.env.INGENIUM_LEARNING_CREDENTIAL_FILE = ".opencode/.ingenium-learning-credential";

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${generalToken}`);
    expect(apiRequestHeaders(worktree, undefined, { purpose: "learning" }).get("Authorization")).toBe(`Bearer ${learningToken}`);
  });

  it("rejects an explicit invalid path without falling back to the protected default", () => {
    writeFallbackToken("f".repeat(32));
    process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = "general";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = join(worktree, "outside-token");

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });

  it("rejects group-readable fallback files", () => {
    writeFallbackToken("f".repeat(32), 0o640);

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });

  it("uses a secure absolute token file configured for the extension", () => {
    const tokenPath = join(worktree, ".ingenium-mcp-credential");
    const token = "a".repeat(32);
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = tokenPath;

    expect(apiRequestHeaders(worktree).get("Authorization")).toBe(`Bearer ${token}`);
  });

  it("rejects a symlinked configured token file", () => {
    const targetPath = join(worktree, "target-token");
    const linkedPath = join(worktree, ".ingenium-mcp-credential");
    writeFileSync(targetPath, `${"a".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, linkedPath);
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = linkedPath;

    expect(apiRequestHeaders(worktree).has("Authorization")).toBe(false);
  });

  it.each([[401, "authentication"], [403, "scope"], [404, "not_found"]] as const)("classifies HTTP %i as a safe failure without exposing request details", async (status, failure) => {
    const token = "f".repeat(32);
    const apiBase = "http://localhost:4097/api/v1";
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

  it.each(["https://attacker.example/api/v1", "http://attacker.example/api/v1"])(
    "never sends authorization to a repository-configured %s endpoint",
    async (untrustedApiUrl) => {
      writeFallbackToken("f".repeat(32));
      writeConfig(untrustedApiUrl);
      const request = vi.fn();

      const result = await preflightApiAuthentication(untrustedApiUrl, worktree, request);

      expect(result).toMatchObject({ authenticated: false, failure: "invalid_target" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("fails closed when explicit operator API origins conflict", async () => {
    writeFallbackToken("f".repeat(32));
    writeConfig("http://localhost:4097/api/v1");
    process.env.INGENIUM_API_URL = "https://operator-one.example/api/v1";
    process.env.INGENIUM_TRUSTED_API_URL = "https://operator-two.example/api/v1";
    const request = vi.fn();

    const result = await preflightApiAuthentication("https://operator-one.example/api/v1", worktree, request);

    expect(result).toMatchObject({ authenticated: false, failure: "invalid_target" });
    expect(request).not.toHaveBeenCalled();
  });

  it("allows the canonical loopback endpoint from current project config", async () => {
    const token = "f".repeat(32);
    writeFallbackToken(token);
    writeConfig("http://localhost:4097/api/v1");
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://localhost:4097/api/v1/auth/preflight");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
      return successfulPreflight();
    });

    await expect(preflightApiAuthentication("http://localhost:4097/api/v1", worktree, request as typeof fetch))
      .resolves.toMatchObject({ authenticated: true });
    expect(request).toHaveBeenCalledOnce();
  });

  it("allows an operator-controlled remote HTTPS endpoint", async () => {
    const token = "f".repeat(32);
    writeFallbackToken(token);
    writeConfig("http://localhost:4097/api/v1");
    process.env.INGENIUM_TRUSTED_API_URL = "https://trusted.example/api/v1";
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://trusted.example/api/v1/auth/preflight");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
      return successfulPreflight();
    });

    await expect(preflightApiAuthentication("https://trusted.example/api/v1", worktree, request as typeof fetch))
      .resolves.toMatchObject({ authenticated: true });
    expect(request).toHaveBeenCalledOnce();
  });

  it("rejects a remote API URL without the explicit trusted authority", async () => {
    writeFallbackToken("f".repeat(32));
    process.env.INGENIUM_API_URL = "https://untrusted.example/api/v1";
    const request = vi.fn();

    const result = await preflightApiAuthentication("https://untrusted.example/api/v1", worktree, request);

    expect(result).toMatchObject({ authenticated: false, failure: "invalid_target" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects an operator-controlled non-loopback HTTP endpoint without sending authorization", async () => {
    writeFallbackToken("f".repeat(32));
    process.env.INGENIUM_TRUSTED_API_URL = "http://remote.example/api/v1";
    const request = vi.fn();

    const result = await preflightApiAuthentication("http://remote.example/api/v1", worktree, request);

    expect(result).toMatchObject({ authenticated: false, failure: "invalid_target" });
    expect(request).not.toHaveBeenCalled();
  });
});
