import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CoordinationResetError,
  installCoordinationCredentialAtomically,
  parseCoordinationResetArgs,
  persistEncryptedOwnerSecret,
  readProtectedOwnerSecret,
  resetCoordinationCredential,
  resetLearningCredential,
} from "./coordination-reset.js";

const oldToken = `ing_${"a".repeat(12)}_${"b".repeat(43)}`;
const newToken = `ing_${"c".repeat(12)}_${"d".repeat(43)}`;
const projectId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const servicePrincipalId = "00000000-0000-4000-8000-000000000005";
const directories: string[] = [];
const originalSecretFile = process.env.INGENIUM_COORDINATION_OWNER_SECRET_FILE;
const originalSecretFd = process.env.INGENIUM_COORDINATION_OWNER_SECRET_FD;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSecretFile === undefined) delete process.env.INGENIUM_COORDINATION_OWNER_SECRET_FILE;
  else process.env.INGENIUM_COORDINATION_OWNER_SECRET_FILE = originalSecretFile;
  if (originalSecretFd === undefined) delete process.env.INGENIUM_COORDINATION_OWNER_SECRET_FD;
  else process.env.INGENIUM_COORDINATION_OWNER_SECRET_FD = originalSecretFd;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(existing = true, secret: { email?: string; mfaCredential?: string } = {}) {
  const worktree = mkdtempSync(join(tmpdir(), "ingenium-coordination-reset-"));
  directories.push(worktree);
  const opencode = join(worktree, ".opencode");
  mkdirSync(opencode, { mode: 0o700 });
  writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
    mcp: { ingenium: { environment: {
      INGENIUM_API_URL: "http://localhost:4097/api/v1",
      INGENIUM_PROJECT: "ingenium",
      INGENIUM_WORKSPACE_ID: "shared-memory-ingenium",
      INGENIUM_WORKTREE: worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
    } } },
  }));
  const credential = join(opencode, ".ingenium-mcp-credential");
  if (existing) {
    writeFileSync(credential, `${oldToken}\n`, { mode: 0o600 });
    chmodSync(credential, 0o600);
  }
  const secretDirectory = join(worktree, "owner");
  mkdirSync(secretDirectory, { mode: 0o700 });
  const secretFile = join(secretDirectory, "bootstrap.json");
  writeFileSync(secretFile, JSON.stringify({ email: "owner@example.test", password: "owner password fixture", ...secret }), { mode: 0o600 });
  chmodSync(secretFile, 0o600);
  process.env.INGENIUM_COORDINATION_OWNER_SECRET_FILE = secretFile;
  delete process.env.INGENIUM_COORDINATION_OWNER_SECRET_FD;
  return { worktree, credential, secretFile };
}

function providerFixture() {
  const fixtureState = fixture(true, { email: "bootstrap-admin@localhost" });
  const providerRoot = mkdtempSync(join(tmpdir(), "ingenium-owner-provider-"));
  directories.push(providerRoot);
  chmodSync(providerRoot, 0o700);
  const keyDirectory = join(providerRoot, "key");
  const bundleDirectory = join(providerRoot, "bundles");
  mkdirSync(keyDirectory, { mode: 0o700 });
  const keyFile = join(keyDirectory, "provider.key");
  writeFileSync(keyFile, `${"a".repeat(64)}\n`, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  return { ...fixtureState, providerRoot, keyFile, bundleDirectory };
}

function response(data: unknown, status = 200, setCookie?: string): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json", ...(setCookie ? { "set-cookie": setCookie } : {}) },
  });
}

function requestFixture(options: {
  scopes?: readonly string[];
  loginStatus?: number;
  loginErrorEnvelope?: boolean;
  mfa?: boolean;
  stepUp?: boolean;
  launcherWorktree?: string;
} = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const scopes = options.scopes ?? ["coordination:read", "coordination:write", "projects:read", "repository:sync"];
  let launcherWorktree = "";
  const request = vi.fn(async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/auth/csrf")) return response({ csrfToken: "p".repeat(43) }, 200, "__Host-ingenium_pre_auth=preauth; Path=/; Secure");
    if (url.endsWith("/auth/login")) {
      if (options.mfa) return response({ challengeToken: "m".repeat(43) }, 202);
      const status = options.loginStatus ?? 200;
      if (options.loginErrorEnvelope) {
        return new Response(JSON.stringify({ error: { code: "AUTHENTICATION_FAILED" } }), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      return response({ csrfToken: "l".repeat(43) }, status, "__Host-ingenium_session=login; Path=/; Secure");
    }
    if (url.endsWith("/auth/mfa/challenge")) {
      return response({ csrfToken: "l".repeat(43) }, 200, "__Host-ingenium_session=login; Path=/; Secure");
    }
    if (url.endsWith("/auth/step-up")) return response(
      { csrfToken: "s".repeat(43), recentStepUp: options.stepUp ?? true },
      options.stepUp === false ? 403 : 200,
      "__Host-ingenium_session=elevated; Path=/; Secure",
    );
    if (url.endsWith("/projects/ingenium/detail")) {
      return response({ project: { id: projectId, organization_id: organizationId, name: "ingenium" } });
    }
    if (url.endsWith("/auth/mcp-credentials") && !init?.method) return response([{
      id: "00000000-0000-4000-8000-000000000004",
      servicePrincipalId,
      revokedAt: null,
      kind: "service",
      audience: "mcp",
      projectId,
      workspaceId: "shared-memory-ingenium",
      launcherWorktree: options.launcherWorktree ?? launcherWorktree,
      scopes,
    }]);
    if (url.endsWith("/auth/mcp-credentials") && init?.method === "POST") {
      launcherWorktree = JSON.parse(String(init.body)).launcherWorktree;
      return response({
      id: "00000000-0000-4000-8000-000000000003",
      token: newToken,
      kind: "service",
      audience: "mcp",
      projectId,
      projectIds: [projectId],
      workspaceId: "shared-memory-ingenium",
      launcherWorktree,
      scopes,
      }, 201);
    }
    if (url.endsWith("/auth/preflight")) return response({
      audience: "mcp",
      projectId,
      projectIds: [projectId],
      workspaceId: "shared-memory-ingenium",
      launcherWorktree: (init?.headers as Record<string, string>)["x-ingenium-launcher-worktree"],
      scopes,
    });
    if (url.includes("/auth/mcp-credentials/") && init?.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error("unexpected request");
  }) as unknown as typeof fetch;
  return { request, calls };
}

describe("protected coordination reset", () => {
  it("uses owner login and recent step-up, installs a minimum-scope binding, and revokes the prior value", async () => {
    const { worktree, credential } = fixture();
    const { request, calls } = requestFixture({ launcherWorktree: worktree });

    await expect(resetCoordinationCredential(worktree, {
      request,
      sourceFingerprint: () => Buffer.from("unchanged"),
      now: () => Date.parse("2026-08-27T00:00:00Z"),
    })).resolves.toEqual({ status: "completed" });

    expect(readFileSync(credential, "utf8")).toBe(`${newToken}\n`);
    expect(statSync(credential).mode & 0o777).toBe(0o600);
    expect(calls.map((call) => `${call.init?.method ?? "GET"} ${new URL(call.url).pathname}`)).toEqual([
      "GET /api/v1/auth/csrf",
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/step-up",
      "GET /api/v1/projects/ingenium/detail",
      "GET /api/v1/auth/mcp-credentials",
      "POST /api/v1/auth/mcp-credentials",
      "GET /api/v1/auth/preflight",
      "DELETE /api/v1/auth/mcp-credentials/00000000-0000-4000-8000-000000000004",
    ]);
    expect(calls.map((call) => new URL(call.url).origin)).toEqual([
      "http://localhost:3000",
      "http://localhost:3000",
      "http://localhost:3000",
      "http://localhost:3000",
      "http://localhost:3000",
      "http://localhost:3000",
      "http://localhost:4097",
      "http://localhost:3000",
    ]);
    expect(calls.map((call) => new Headers(call.init?.headers).get("x-ingenium-ui"))).toEqual([
      null,
      "dashboard",
      "dashboard",
      null,
      null,
      "dashboard",
      null,
      "dashboard",
    ]);
    const issuance = JSON.parse(String(calls[5]!.init!.body));
    expect(issuance).toMatchObject({
      servicePrincipalId,
      kind: "service",
      audience: "mcp",
      scopes: ["coordination:read", "coordination:write", "projects:read", "repository:sync"],
      projectId,
      projectIds: [projectId],
      workspaceId: "shared-memory-ingenium",
      launcherWorktree: worktree,
    });
  });

  it("rotates the isolated learning credential through the encrypted owner authority", async () => {
    const { worktree } = fixture();
    const credential = join(worktree, ".opencode", ".ingenium-learning-credential");
    writeFileSync(credential, `${oldToken}\n`, { mode: 0o600 });
    const scopes = [
      "projects:read", "extraction:write", "extraction:execute", "synthesis:write", "synthesis:execute",
      "pipeline:write", "observe:write",
    ];
    const { request, calls } = requestFixture({ launcherWorktree: worktree, scopes });

    await expect(resetLearningCredential(worktree, {
      request,
      sourceFingerprint: () => Buffer.from("unchanged"),
      now: () => Date.parse("2026-08-27T00:00:00Z"),
    })).resolves.toEqual({ status: "completed" });

    expect(readFileSync(credential, "utf8")).toBe(`${newToken}\n`);
    expect(statSync(credential).mode & 0o777).toBe(0o600);
    const issue = calls.find(({ url, init }) => url.endsWith("/auth/mcp-credentials") && init?.method === "POST");
    expect(JSON.parse(String(issue?.init?.body))).toMatchObject({
      servicePrincipalId,
      name: "Ingenium learning",
      scopes,
    });
  });

  it("marks the MFA mutation without changing Dashboard reads or MCP preflight", async () => {
    const { worktree } = fixture(true, { mfaCredential: "123456" });
    const { request, calls } = requestFixture({ mfa: true });

    await resetCoordinationCredential(worktree, { request, sourceFingerprint: () => Buffer.from("same") });

    const routes = calls.map((call) => ({
      method: call.init?.method ?? "GET",
      origin: new URL(call.url).origin,
      path: new URL(call.url).pathname,
      marker: new Headers(call.init?.headers).get("x-ingenium-ui"),
    }));
    expect(routes.filter(({ origin, method }) => origin === "http://localhost:3000" && method !== "GET"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "/api/v1/auth/login", marker: "dashboard" }),
        expect.objectContaining({ path: "/api/v1/auth/mfa/challenge", marker: "dashboard" }),
        expect.objectContaining({ path: "/api/v1/auth/step-up", marker: "dashboard" }),
        expect.objectContaining({ path: "/api/v1/auth/mcp-credentials", marker: "dashboard" }),
      ]));
    expect(routes.filter(({ method }) => method === "GET").every(({ marker }) => marker === null)).toBe(true);
  });

  it("recovers a missing credential and leaves source state unchanged", async () => {
    const { worktree, credential } = fixture(false);
    const { request } = requestFixture();
    const sourceFingerprint = vi.fn(() => Buffer.from("same-dirty-state"));
    await resetCoordinationCredential(worktree, { request, sourceFingerprint });
    expect(readFileSync(credential, "utf8")).toBe(`${newToken}\n`);
    expect(sourceFingerprint).toHaveBeenCalledTimes(2);
  });

  it("persists authenticated ciphertext and uses it only when explicit sources are absent", async () => {
    const { worktree, credential, keyFile, bundleDirectory } = providerFixture();
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    persistEncryptedOwnerSecret(worktree, { keyFile, bundleDirectory });

    delete process.env.INGENIUM_COORDINATION_OWNER_SECRET_FILE;
    delete process.env.INGENIUM_COORDINATION_OWNER_SECRET_FD;
    const { request } = requestFixture();
    await resetCoordinationCredential(worktree, { request, sourceFingerprint: () => Buffer.from("same") });

    const reference = join(worktree, ".opencode/.ingenium-coordination-owner-provider.json");
    const bundle = join(bundleDirectory, readdirSync(bundleDirectory)[0]!);
    expect(readFileSync(credential, "utf8")).toBe(`${newToken}\n`);
    expect(statSync(reference).mode & 0o777).toBe(0o600);
    expect(statSync(bundle).mode & 0o777).toBe(0o600);
    expect(readFileSync(bundle, "utf8")).not.toContain("owner password fixture");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each(["tampered bundle", "wrong key", "unsafe key mode", "symlink reference", "project mismatch"])(
    "fails closed for a %s without replacing the MCP credential",
    async (failure) => {
      const { worktree, credential, keyFile, bundleDirectory } = providerFixture();
      persistEncryptedOwnerSecret(worktree, { keyFile, bundleDirectory });
      const reference = join(worktree, ".opencode/.ingenium-coordination-owner-provider.json");
      const provider = JSON.parse(readFileSync(reference, "utf8")) as { bundleFile: string };
      if (failure === "tampered bundle") {
        const envelope = JSON.parse(readFileSync(provider.bundleFile, "utf8")) as { payload: string };
        envelope.payload = `${envelope.payload.slice(0, -1)}${envelope.payload.endsWith("a") ? "b" : "a"}`;
        writeFileSync(provider.bundleFile, JSON.stringify(envelope), { mode: 0o600 });
      } else if (failure === "wrong key") {
        writeFileSync(keyFile, `${"b".repeat(64)}\n`, { mode: 0o600 });
      } else if (failure === "unsafe key mode") {
        chmodSync(keyFile, 0o644);
      } else if (failure === "symlink reference") {
        const outside = join(worktree, "provider-reference.json");
        writeFileSync(outside, readFileSync(reference), { mode: 0o600 });
        unlinkSync(reference);
        symlinkSync(outside, reference);
      } else {
        const envelope = JSON.parse(readFileSync(provider.bundleFile, "utf8")) as { project: string };
        envelope.project = "other";
        writeFileSync(provider.bundleFile, JSON.stringify(envelope), { mode: 0o600 });
      }
      delete process.env.INGENIUM_COORDINATION_OWNER_SECRET_FILE;
      delete process.env.INGENIUM_COORDINATION_OWNER_SECRET_FD;

      await expect(resetCoordinationCredential(worktree, {
        request: requestFixture().request,
        sourceFingerprint: () => Buffer.from("same"),
      })).rejects.toMatchObject({ failure: "binding" });
      expect(readFileSync(credential, "utf8")).toBe(`${oldToken}\n`);
    },
  );

  it("keeps the prior provider usable and removes a new bundle after an interrupted store", () => {
    const { worktree, keyFile, bundleDirectory } = providerFixture();
    persistEncryptedOwnerSecret(worktree, { keyFile, bundleDirectory });
    const reference = join(worktree, ".opencode/.ingenium-coordination-owner-provider.json");
    const before = readFileSync(reference, "utf8");

    expect(() => persistEncryptedOwnerSecret(worktree, { keyFile, bundleDirectory }, {
      afterBundleRename: () => { throw new Error("interrupt"); },
    })).toThrow(CoordinationResetError);
    expect(readFileSync(reference, "utf8")).toBe(before);
    expect(readdirSync(bundleDirectory)).toHaveLength(1);
    delete process.env.INGENIUM_COORDINATION_OWNER_SECRET_FILE;
    expect(readProtectedOwnerSecret(worktree).email).toBe("bootstrap-admin@localhost");
  });

  it("removes the superseded ciphertext after a successful provider rotation", () => {
    const { worktree, keyFile, bundleDirectory } = providerFixture();
    persistEncryptedOwnerSecret(worktree, { keyFile, bundleDirectory });
    const previousBundle = readdirSync(bundleDirectory)[0]!;

    persistEncryptedOwnerSecret(worktree, { keyFile, bundleDirectory });

    const bundles = readdirSync(bundleDirectory);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).not.toBe(previousBundle);
  });

  it.each([
    ["login", { loginStatus: 401, loginErrorEnvelope: true }, "authentication"],
    ["csrf", { loginStatus: 403, loginErrorEnvelope: true }, "authentication"],
    ["step-up", { stepUp: false }, "authorization"],
    ["scope", { scopes: ["coordination:read"] }, "credential_issue"],
  ] as const)("rejects wrong %s authority without replacing the credential", async (_name, options, failure) => {
    const { worktree, credential } = fixture();
    const { request, calls } = requestFixture(options);
    await expect(resetCoordinationCredential(worktree, { request, sourceFingerprint: () => Buffer.from("same") }))
      .rejects.toMatchObject({ failure });
    expect(readFileSync(credential, "utf8")).toBe(`${oldToken}\n`);
    expect(new Headers(calls.find(({ url }) => url.endsWith("/auth/login"))?.init?.headers).get("x-ingenium-ui"))
      .toBe("dashboard");
  });

  it("rejects a symlink target and rolls back an interrupted rename", () => {
    const linked = fixture(false);
    const outside = join(linked.worktree, "outside");
    writeFileSync(outside, `${oldToken}\n`, { mode: 0o600 });
    symlinkSync(outside, linked.credential);
    expect(() => installCoordinationCredentialAtomically(linked.worktree, newToken))
      .toThrow(CoordinationResetError);
    expect(readFileSync(outside, "utf8")).toBe(`${oldToken}\n`);

    const interrupted = fixture();
    expect(() => installCoordinationCredentialAtomically(interrupted.worktree, newToken, {
      afterRename: () => { throw new Error("interrupt"); },
    })).toThrow(CoordinationResetError);
    expect(readFileSync(interrupted.credential, "utf8")).toBe(`${oldToken}\n`);
    expect(statSync(interrupted.credential).mode & 0o777).toBe(0o600);
  });

  it("allows one concurrent reset winner", async () => {
    const { worktree } = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const base = requestFixture().request;
    let first = true;
    const request = vi.fn(async (input: any, init?: RequestInit) => {
      if (first) { first = false; await gate; }
      return base(input, init);
    }) as unknown as typeof fetch;
    const running = resetCoordinationCredential(worktree, { request, sourceFingerprint: () => Buffer.from("same") });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await expect(resetCoordinationCredential(worktree, { request, sourceFingerprint: () => Buffer.from("same") }))
      .rejects.toMatchObject({ failure: "already_running" });
    release();
    await expect(running).resolves.toEqual({ status: "completed" });
  });

  it("accepts only the fixed reset operation", () => {
    expect(parseCoordinationResetArgs(["reset"])).toBe("reset");
    expect(parseCoordinationResetArgs(["reset-learning"])).toBe("reset-learning");
    expect(parseCoordinationResetArgs(["store", "--key-file", "/key", "--bundle-directory", "/bundle"]))
      .toEqual({ keyFile: "/key", bundleDirectory: "/bundle" });
    for (const args of [[], ["reset", "extra"], ["--project", "other"], ["reset;curl"], ["RESET"], ["store", "/key", "/bundle"]]) {
      expect(() => parseCoordinationResetArgs(args)).toThrow(CoordinationResetError);
    }
  });
});
