import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const originalToken = process.env.INGENIUM_API_TOKEN;
const originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
const originalInternalService = process.env.INGENIUM_INTERNAL_SERVICE;
const originalRuntimeCredential = process.env.INGENIUM_RUNTIME_CREDENTIAL;
const originalMcpCredential = process.env.INGENIUM_MCP_CREDENTIAL;
const originalMcpCredentialFile = process.env.INGENIUM_MCP_CREDENTIAL_FILE;
const originalMcpAudience = process.env.INGENIUM_MCP_AUDIENCE;

function errorResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status });
}

afterEach(() => {
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
  if (originalInternalService === undefined) delete process.env.INGENIUM_INTERNAL_SERVICE;
  else process.env.INGENIUM_INTERNAL_SERVICE = originalInternalService;
  if (originalRuntimeCredential === undefined) delete process.env.INGENIUM_RUNTIME_CREDENTIAL;
  else process.env.INGENIUM_RUNTIME_CREDENTIAL = originalRuntimeCredential;
  if (originalMcpCredential === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL;
  else process.env.INGENIUM_MCP_CREDENTIAL = originalMcpCredential;
  if (originalMcpCredentialFile === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL_FILE;
  else process.env.INGENIUM_MCP_CREDENTIAL_FILE = originalMcpCredentialFile;
  if (originalMcpAudience === undefined) delete process.env.INGENIUM_MCP_AUDIENCE;
  else process.env.INGENIUM_MCP_AUDIENCE = originalMcpAudience;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Ingenium API client authentication", () => {
  beforeEach(() => { process.env.INGENIUM_INTERNAL_SERVICE = "1"; });
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

  it("sends a binary Context snapshot once with the protected bearer and octet-stream content type", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: "UNAVAILABLE" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    await api.settled.postOctetStream("/context/conversations/import", Buffer.from("{}"), { project: "context-server-test" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:4097/api/v1/context/conversations/import?project=context-server-test",
    );
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1].headers);
    expect(requestHeaders.get("Authorization")).toBe("Bearer test-server-token");
    expect(requestHeaders.get("Content-Type")).toBe("application/octet-stream");
    expect(fetchMock.mock.calls[0]?.[1].body).toEqual(Buffer.from("{}"));
  });

  it("sends email once when the transport fails before a response", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const { emailSend } = await import("../lib/tools/emails.js");
    await expect(emailSend("project", "account", "to@example.test", "subject", "body"))
      .rejects.toMatchObject({ code: "API_UNAVAILABLE", message: "The API is unavailable." });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends email once when the API returns 502", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(502, {
      error: { code: "UPSTREAM_FAILURE" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { emailSend } = await import("../lib/tools/emails.js");
    await expect(emailSend("project", "account", "to@example.test", "subject", "body"))
      .rejects.toMatchObject({ status: 502, code: "UPSTREAM_FAILURE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries safe GET requests and keyed API mutations", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const unavailable = { ok: false, status: 502, json: async () => ({ error: { code: "UNAVAILABLE" } }) };
    const ok = { ok: true, status: 200, json: async () => ({ data: { ok: true } }) };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    await expect(api.get("/health")).resolves.toMatchObject({ status: 200, data: { ok: true } });
    await expect(api.post("/tasks", { title: "retry", idempotency_key: "retry-key" })).resolves.toMatchObject({ status: 200 });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchMock.mock.calls[3]?.[1].headers).get("Idempotency-Key")).toBe("retry-key");
  });

  it("does not retry arbitrary keyed mutations", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(502, {
      error: { code: "UPSTREAM_FAILURE" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    await expect(api.post("/emails", { idempotency_key: "not-enforced" }))
      .rejects.toMatchObject({ status: 502, code: "UPSTREAM_FAILURE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires outputPath in the email attachment tool schema", () => {
    const serverSource = readFileSync(fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url)), "utf8");
    expect(serverSource).toMatch(/"email_attachment_get"[\s\S]*?outputPath: z\.string\(\)\.min\(1\)/);
  });

  it("preserves existing DELETE params while sending an optional JSON body", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    await api.del(
      "/tasks/task-delete",
      { project: "delete-project" },
      { expected_revision: 6, idempotency_key: "delete-replay-1" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:4097/api/v1/tasks/task-delete?project=delete-project",
    );
    expect(fetchMock.mock.calls[0]?.[1].method).toBe("DELETE");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body as string)).toEqual({
      expected_revision: 6,
      idempotency_key: "delete-replay-1",
    });
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1].headers);
    expect(requestHeaders.get("Authorization")).toBe("Bearer test-server-token");
    expect(requestHeaders.get("Idempotency-Key")).toBe("delete-replay-1");
  });

  it("uses the dedicated server-only child-MCP runtime handoff outside the dashboard API namespace", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    process.env.INGENIUM_RUNTIME_CREDENTIAL = "test-server-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { definitions: [], unavailable: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const {
      api,
      CHILD_MCP_RUNTIME_HANDOFF_HEADER,
      CHILD_MCP_RUNTIME_HANDOFF_PATH,
    } = await import("../lib/client.js");
    await api.settled.getTrustedChildMcpRuntime("runtime project");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `http://localhost:4097${CHILD_MCP_RUNTIME_HANDOFF_PATH}?project=runtime+project`,
    );
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1].headers);
    expect(requestHeaders.get("Authorization")).toBe("Bearer test-server-token");
    expect(requestHeaders.get(CHILD_MCP_RUNTIME_HANDOFF_HEADER)).toBe("1");
  });

  it("preserves the attested tool-state envelope behind the bearer boundary", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const payload = {
      project: "state-project",
      project_id: "state-project-id",
      data: { tool_name: "ingenium_skill_list", enabled: true },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    await expect(api.settled.getToolState("ingenium_skill_list", "state-project")).resolves.toMatchObject({
      data: payload.data,
      payload,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:4097/api/v1/mcp-tools/ingenium_skill_list/state?project=state-project",
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get("Authorization")).toBe("Bearer test-server-token");
  });

  it("sends coordination ownership proof only in the dedicated internal header", async () => {
    process.env.INGENIUM_API_TOKEN = "test-server-token";
    const ownershipToken = "C".repeat(32);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { session: {}, claims: [], peers: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../lib/client.js");
    await api.settled.getCoordinationSnapshot(
      "coordination-project", "worktree-main", "session-main", 1, ownershipToken,
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:4097/api/v1/coordination/snapshot?project=coordination-project&worktree_id=worktree-main&session_id=session-main&incarnation=1",
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain(ownershipToken);
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1].headers);
    expect(requestHeaders.get("X-Ingenium-Coordination-Ownership")).toBe(ownershipToken);
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

  it("resolves only the repository-sync credential file for that audience", async () => {
    const originalCwd = process.cwd();
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-server-repository-auth-"));
    const opencodeDir = join(worktree, ".opencode");
    mkdirSync(opencodeDir);
    writeFileSync(join(opencodeDir, ".ingenium-mcp-credential"), "wrong-mcp-token\n", { mode: 0o600 });
    writeFileSync(join(opencodeDir, ".ingenium-repository-sync-credential"), "repository-token\n", { mode: 0o600 });
    process.chdir(worktree);
    delete process.env.INGENIUM_MCP_CREDENTIAL;
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = ".opencode/.ingenium-repository-sync-credential";
    process.env.INGENIUM_MCP_AUDIENCE = "repository-sync";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { api } = await import("../lib/client.js");
      await api.get("/health");
      const headers = new Headers(fetchMock.mock.calls[0]![1].headers);
      expect(headers.get("Authorization")).toBe("Bearer repository-token");
      expect(headers.get("X-Ingenium-Audience")).toBe("repository-sync");
      expect(headers.has("X-Ingenium-Internal-Service")).toBe(false);
    } finally {
      process.chdir(originalCwd);
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("accepts an absolute repository-sync credential in an owner-private directory", async () => {
    const credentialDirectory = mkdtempSync(join(tmpdir(), "ingenium-server-repository-credential-"));
    const tokenPath = join(credentialDirectory, ".ingenium-repository-sync-credential");
    chmodSync(credentialDirectory, 0o700);
    writeFileSync(tokenPath, "repository-token\n", { mode: 0o600 });
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = tokenPath;
    process.env.INGENIUM_MCP_AUDIENCE = "repository-sync";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { api } = await import("../lib/client.js");
      await api.get("/health");
      expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("Authorization")).toBe("Bearer repository-token");
    } finally {
      rmSync(credentialDirectory, { recursive: true, force: true });
    }
  });
});
