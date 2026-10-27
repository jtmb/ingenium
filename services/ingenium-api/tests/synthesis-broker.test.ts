import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, identity, mcpCredentials, observations, organizations, personality, projects, resetDbForTest, runtimes, settings, synthesis } from "ingenium-core";
import { createBackgroundSynthesisBrokerExecutor, executeSynthesisBroker, opencodeClient } from "../lib/opencode-client.js";
import { isLocalRuntimeBinding } from "../lib/runtime-provisioner.js";
import { withOpenCodeRuntimeTarget } from "../lib/runtime-opencode-context.js";

const temporaryPaths: string[] = [];

function configuredProject(primary?: [string, string], secondary?: [string, string], local = false): string {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-synthesis-broker-"));
  temporaryPaths.push(directory);
  vi.stubEnv("INGENIUM_HOME", directory);
  vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH", join(directory, "opencode-global"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "test.db");
  resetDbForTest();
  const project = projects.createProject(local ? "ingenium" : `broker-${Date.now()}-${Math.random()}`);
  if (primary) {
    settings.setSetting(project.id, "synthesis_provider", primary[0]);
    settings.setSetting(project.id, "synthesis_model", primary[1]);
  }
  if (secondary) {
    settings.setSetting(project.id, "synthesis_backup_provider", secondary[0]);
    settings.setSetting(project.id, "synthesis_backup_model", secondary[1]);
  }
  const providerConfigs = new Map<string, { id: string; name: string; models: string[]; roles: string[]; enabled: boolean; defaultModel: string }>();
  for (const [providerId, modelId, role] of [
    ...(primary ? [[primary[0], primary[1], "primary"] as const] : []),
    ...(secondary ? [[secondary[0], secondary[1], "backup"] as const] : []),
  ]) {
    const existing = providerConfigs.get(providerId);
    if (existing) {
      if (!existing.models.includes(modelId)) existing.models.push(modelId);
      if (!existing.roles.includes(role)) existing.roles.push(role);
      continue;
    }
    providerConfigs.set(providerId, {
      id: providerId,
      name: providerId,
      models: [modelId],
      defaultModel: modelId,
      roles: ["available", role],
      enabled: true,
    });
  }
  settings.setSetting(project.id, "llm_provider_configs", JSON.stringify([...providerConfigs.values()]));
  return project.id;
}

function activateRuntime(
  projectId: string,
  owner = identity.createUser(`runtime-${crypto.randomUUID()}@example.test`, "Runtime Owner"),
  authorizeAutomation = false,
  local = false,
): runtimes.RuntimeInstance {
  const project = projects.listProjects().find((candidate) => candidate.id === projectId)!;
  organizations.addOrganizationMember(project.organization_id, owner.id, "member");
  organizations.addProjectMember(projectId, owner.id, "editor");
  const workspaceId = local ? "shared-memory-ingenium" : `workspace-${crypto.randomUUID()}`;
  const storagePath = local ? "/home/brajam/repos/ingenium" : `/srv/approved/${workspaceId}`;
  if (local) {
    const now = new Date().toISOString();
    getDb().prepare("UPDATE bootstrap_state SET state = 'claimed', owner_user_id = ?, claimed_at = ?, updated_at = ? WHERE singleton = 1")
      .run(owner.id, now, now);
  }
  runtimes.authorizeWorkspace({
    id: workspaceId,
    organizationId: project.organization_id,
    projectId,
    ownerUserId: owner.id,
    storagePath,
  });
  let runtime = runtimes.createRuntimeInstance(workspaceId, {
    cpuMillis: 1_000,
    memoryBytes: 536_870_912,
    pidsLimit: 128,
    diskBytes: 536_870_912,
    processLimit: 64,
  });
  const credential = mcpCredentials.createMcpCredential({
    servicePrincipalName: `Runtime ${runtime.id}`,
    kind: "runtime",
    audience: "runtime",
    name: `Runtime ${runtime.id}`,
    scopes: ["child-mcp:runtime", "projects:read"],
    organizationId: project.organization_id,
    projectId,
    workspaceId,
    launcherWorktree: storagePath,
    expiresAt: new Date(Date.now() + 60_000),
    createdByUserId: owner.id,
  });
  runtimes.bindRuntimeCapability(runtime.id, credential.id);
  for (const toState of ["PROVISIONING", "STARTING", "READY"] as const) {
    runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState, actorType: "system", actorId: "test",
      idleExpiresAt: new Date(Date.now() + 300_000), absoluteExpiresAt: new Date(Date.now() + 600_000) });
  }
  if (authorizeAutomation) runtime = runtimes.authorizeRuntimeAutomation(workspaceId, owner.id);
  return runtime;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  resetDbForTest();
  while (temporaryPaths.length) rmSync(temporaryPaths.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({ all: [] });
});

describe("executeSynthesisBroker", () => {
  it.each([undefined, { providerID: "openai", modelID: "gpt-6-luna" }])("returns unavailable without transport or provider probes when no authorized executor exists (choice %j)", async (selection) => {
    const projectId = configuredProject();
    const providers = vi.spyOn(opencodeClient, "listProviders");

    await expect(createBackgroundSynthesisBrokerExecutor(projectId, selection ? { ...selection, runtimeId: "missing-runtime", ownerUserId: "missing-owner" } : undefined)({
      system: "system",
      user: "user",
      timeoutMs: 1_000,
    })).resolves.toEqual({
      ok: false,
      content: "",
      error: "no authorized synthesis automation executor configured",
    });
    expect(providers).not.toHaveBeenCalled();
  });

  it.each([undefined, { providerID: "openai", modelID: "gpt-6-luna" }])("never sends a victim-private observation to another member's runtime or global target (choice %j)", async (selection) => {
    const canary = "VICTIM_PRIVATE_SYNTHESIS_CANARY";
    const projectId = configuredProject(["custom", "model-a"]);
    const project = projects.listProjects().find((candidate) => candidate.id === projectId)!;
    const victim = identity.createUser(`victim-${crypto.randomUUID()}@example.test`, "Victim");
    const attacker = identity.createUser(`attacker-${crypto.randomUUID()}@example.test`, "Attacker");
    organizations.addOrganizationMember(project.organization_id, victim.id, "member");
    const runtime = activateRuntime(projectId, attacker);
    observations.storeObservation(projectId, "preference", canary, 10, "manual", undefined, undefined, {
      organizationId: project.organization_id,
      ownerUserId: victim.id,
      visibility: "private",
    });
    const fetchMock = vi.fn();
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-password");
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesis.runSynthesis(projectId, undefined, {
      llmExecutor: createBackgroundSynthesisBrokerExecutor(projectId, selection ? { ...selection, runtimeId: runtime.id, ownerUserId: runtime.ownerUserId } : undefined),
    });

    expect(result.summary).toContain("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(canary);
  });

  it.each([undefined, { providerID: "openai", modelID: "gpt-6-luna" }])("executes synthesis through an explicitly authorized automation runtime (choice %j)", async (selection) => {
    const projectId = configuredProject(["custom", "model-a"], undefined, true);
    const runtime = activateRuntime(projectId, undefined, true, true);
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
    vi.stubEnv("INGENIUM_RUNTIME_MANAGER_URL", "");
    const credentialDirectory = mkdtempSync(join(tmpdir(), "ingenium-synthesis-password-"));
    temporaryPaths.push(credentialDirectory);
    const credentialPath = join(credentialDirectory, "password");
    const password = "s".repeat(64);
    writeFileSync(credentialPath, `${password}\n`, { mode: 0o600 });
    vi.stubEnv("OPENCODE_SERVER_PASSWORD_FILE", credentialPath);
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    expect(runtimes.getReadyRuntimeForProject(projectId)?.id).toBe(runtime.id);
    expect(isLocalRuntimeBinding(runtime, projectId)).toBe(true);
    personality.upsertTrait(projectId, "code_preference", "owner-private-trait", undefined, 0.8, undefined, undefined, {
      ownerUserId: runtime.ownerUserId, visibility: "private",
    });
    const expectedAuth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const session = { id: "ses_broker", projectID: "native-project", location: { directory: "/workspace" }, title: "Broker" };
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      seen.push(`${method} ${url.pathname}`);
      const headers = init?.headers as Record<string, string> | undefined;
      if (url.origin !== "http://127.0.0.1:4098" || headers?.Authorization !== expectedAuth) {
        return new Response("unauthorized", { status: 401 });
      }
      if (method === "POST" && url.pathname === "/api/session") {
        expect(JSON.parse(String(init?.body))).toEqual({ title: "ingenium-llm-broker", location: { directory: "/workspace" } });
        return response({ data: session });
      }
      if (method === "GET" && url.pathname === "/api/session/ses_broker") return response({ data: session });
      if (method === "GET" && url.pathname === "/api/session/ses_broker/message") return response({
        data: [{ id: "msg_assistant", type: "assistant", time: { created: 1, completed: 2 }, finish: "stop", content: [{ type: "text", text: "done" }] }],
        cursor: { next: null },
      });
      if (url.pathname.endsWith("/model")) {
        expect(JSON.parse(String(init?.body))).toEqual({ model: { id: selection?.modelID ?? "model-a", providerID: selection?.providerID ?? "custom" } });
      }
      if (url.pathname.endsWith("/agent")) {
        expect(JSON.parse(String(init?.body))).toEqual({ agent: "ingenium-llm-broker" });
      }
      if (url.pathname.endsWith("/prompt")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ text: "user" });
      }
      if (url.pathname.endsWith("/instructions/entries/ingenium-broker-system") && method === "PUT") {
        expect(JSON.parse(String(init?.body))).toEqual({ value: "system" });
      }
      return response({ data: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    if (selection) {
      for (const fence of [{ runtimeId: "replaced-runtime", ownerUserId: runtime.ownerUserId }, { runtimeId: runtime.id, ownerUserId: "another-owner" }]) {
        await expect(createBackgroundSynthesisBrokerExecutor(projectId, { ...selection, ...fence })({ system: "system", user: "must-not-leave", timeoutMs: 1_000 }))
          .resolves.toMatchObject({ ok: false, error: "no authorized synthesis automation executor configured" });
        expect(fetchMock).not.toHaveBeenCalled();
      }
    }
    const result = await withOpenCodeRuntimeTarget({ baseUrl: "http://foreign.test:4098", password: "foreign-password", directory: "/foreign" }, () =>
      createBackgroundSynthesisBrokerExecutor(projectId, selection ? { ...selection, runtimeId: runtime.id, ownerUserId: runtime.ownerUserId } : undefined)({
        system: "system",
        user: "user",
        timeoutMs: 1_000,
      }));
    expect(seen).toEqual([
      "POST /api/session", "PUT /api/experimental/session/ses_broker/instructions/entries/ingenium-broker-system",
      "GET /api/session/ses_broker", "POST /api/session/ses_broker/model",
      "POST /api/session/ses_broker/agent", "POST /api/session/ses_broker/prompt",
      "GET /api/session/ses_broker", "GET /api/session/ses_broker/message",
      "DELETE /api/experimental/session/ses_broker/instructions/entries/ingenium-broker-system",
      "GET /api/session/ses_broker", "DELETE /api/session/ses_broker",
    ]);
    expect(result).toEqual({ ok: true, content: "done" });
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("http://127.0.0.1:4098"))).toBe(true);
  });

  it("rejects a granted runtime without the compatibility bootstrap binding before any transport", async () => {
    const projectId = configuredProject(["custom", "model-a"]);
    activateRuntime(projectId, undefined, true);
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "synthetic-local-password");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createBackgroundSynthesisBrokerExecutor(projectId)({ system: "system", user: "private-canary", timeoutMs: 1_000 }))
      .resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects the canonical local binding without an active automation grant", async () => {
    const projectId = configuredProject(["custom", "model-a"], undefined, true);
    activateRuntime(projectId, undefined, false, true);
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "synthetic-local-password");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createBackgroundSynthesisBrokerExecutor(projectId)({ system: "system", user: "private-canary", timeoutMs: 1_000 }))
      .resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not borrow the compatibility password in control-plane mode", async () => {
    const projectId = configuredProject(["custom", "model-a"], undefined, true);
    activateRuntime(projectId, undefined, true, true);
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "control-plane");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "synthetic-local-password");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createBackgroundSynthesisBrokerExecutor(projectId)({ system: "system", user: "private-canary", timeoutMs: 1_000 }))
      .resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a locally bound runtime when the protected OpenCode password is unavailable", async () => {
    const projectId = configuredProject(["custom", "model-a"], undefined, true);
    activateRuntime(projectId, undefined, true, true);
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD_FILE", "");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createBackgroundSynthesisBrokerExecutor(projectId)({ system: "system", user: "private-canary", timeoutMs: 1_000 }))
      .resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the configured password file is a symlink", async () => {
    const projectId = configuredProject(["custom", "model-a"], undefined, true);
    activateRuntime(projectId, undefined, true, true);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-synthesis-secret-fixture-"));
    temporaryPaths.push(directory);
    const file = join(directory, "secret");
    writeFileSync(file, "s".repeat(64), { mode: 0o600 });
    const link = join(directory, "link");
    symlinkSync(file, link);
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD_FILE", link);
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createBackgroundSynthesisBrokerExecutor(projectId)({ system: "system", user: "private-canary", timeoutMs: 1_000 }))
      .resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends another owner's pending private observation to the authorized local runtime", async () => {
    const projectId = configuredProject(["custom", "model-a"], undefined, true);
    const project = projects.getProject("ingenium")!;
    const victim = identity.createUser(`victim-${crypto.randomUUID()}@example.test`, "Victim");
    organizations.addOrganizationMember(project.organization_id, victim.id, "member");
    const runtime = activateRuntime(projectId, undefined, true, true);
    const canary = "VICTIM_PRIVATE_SYNTHESIS_CANARY";
    observations.storeObservation(projectId, "preference", canary, 10, "manual", undefined, undefined, {
      organizationId: project.organization_id,
      ownerUserId: victim.id,
      visibility: "private",
    });
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD_FILE", "");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "synthetic-local-password");
    expect(runtimes.getReadyRuntimeForProject(projectId)?.id).toBe(runtime.id);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createBackgroundSynthesisBrokerExecutor(projectId)({ system: "system", user: canary, timeoutMs: 1_000 }))
      .resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send a foreign owner's existing private trait through actual synthesis", async () => {
    const projectId = configuredProject(["custom", "model-a"], undefined, true);
    const project = projects.getProject("ingenium")!;
    const victim = identity.createUser(`victim-${crypto.randomUUID()}@example.test`, "Victim");
    organizations.addOrganizationMember(project.organization_id, victim.id, "member");
    const runtime = activateRuntime(projectId, undefined, true, true);
    const pending = observations.storeObservation(projectId, "preference", "Owner's pending preference", 10, "manual", undefined, undefined, {
      organizationId: project.organization_id, ownerUserId: runtime.ownerUserId, visibility: "private",
    });
    const canary = "FOREIGN_PRIVATE_ACTIVE_TRAIT_CANARY";
    const trait = personality.upsertTrait(projectId, "code_preference", canary, undefined, 0.8, undefined, undefined, {
      ownerUserId: victim.id, visibility: "private",
    });
    expect(personality.getTraits(projectId).some(({ id }) => id === trait.id)).toBe(true);
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
    vi.stubEnv("INGENIUM_RUNTIME_MANAGER_URL", "");
    const credentialDirectory = mkdtempSync(join(tmpdir(), "ingenium-synthesis-trait-secret-"));
    temporaryPaths.push(credentialDirectory);
    const credentialPath = join(credentialDirectory, "password");
    writeFileSync(credentialPath, `${"s".repeat(64)}\n`, { mode: 0o600 });
    vi.stubEnv("OPENCODE_SERVER_PASSWORD_FILE", credentialPath);
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "");
    expect(runtimes.getReadyRuntimeForProject(projectId)?.id).toBe(runtime.id);
    const fetchMock = vi.fn(async () => response({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesis.runSynthesis(projectId, undefined, {
      llmExecutor: createBackgroundSynthesisBrokerExecutor(projectId),
    });

    expect(result.summary).toContain("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(canary);
    expect(observations.getObservation(projectId, pending.id)?.status).toBe("pending");
    expect(personality.getTraits(projectId).find(({ id }) => id === trait.id)).toMatchObject({
      trait_value: canary, confidence: 0.8, is_active: 1,
    });
  });

  it("does not borrow a local runtime authorized for a different project", async () => {
    const projectId = configuredProject(["custom", "model-a"], undefined, true);
    activateRuntime(projectId, undefined, true, true);
    const foreign = projects.createProject(`foreign-${crypto.randomUUID()}`);
    vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "synthetic-local-password");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createBackgroundSynthesisBrokerExecutor(foreign.id)({ system: "system", user: "private-canary", timeoutMs: 1_000 }))
      .resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an absent selection without executing", async () => {
    const executor = vi.fn();
    const result = await executeSynthesisBroker({ projectId: configuredProject(), system: "system", user: "user", executor });
    expect(result).toEqual({ ok: false, content: "", error: "no synthesis provider configured" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("uses the primary project's configured provider and model", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: true, content: "primary" });
    const result = await executeSynthesisBroker({ projectId: configuredProject(["custom", "model-a"]), system: "system", user: "user", executor });
    expect(result).toEqual({ ok: true, content: "primary" });
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ providerID: "custom", modelID: "model-a", system: "system", user: "user" }));
  });

  it("uses a route-validated explicit selection without silently falling back", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: false, content: "", error: "selected model failed" });
    const result = await executeSynthesisBroker({
      projectId: configuredProject(["primary", "model-a"], ["backup", "model-b"]),
      system: "system",
      user: "user",
      selection: { providerID: "chat-provider", modelID: "chat-model" },
      executor,
    });

    expect(result).toEqual({ ok: false, content: "", error: "selected model failed" });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      providerID: "chat-provider",
      modelID: "chat-model",
    }));
  });

  it("falls back from primary to secondary", async () => {
    const executor = vi.fn()
      .mockResolvedValueOnce({ ok: false, content: "", error: "primary failed" })
      .mockResolvedValueOnce({ ok: true, content: "secondary" });
    const result = await executeSynthesisBroker({ projectId: configuredProject(["custom", "model-a"], ["custom", "model-b"]), system: "system", user: "user", executor });
    expect(result).toEqual({ ok: true, content: "secondary" });
    expect(executor.mock.calls.map(([call]) => [call.providerID, call.modelID])).toEqual([["custom", "model-a"], ["custom", "model-b"]]);
  });

  it("returns a safe failure after both configured providers fail", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: false, content: "", error: "unavailable" });
    const result = await executeSynthesisBroker({ projectId: configuredProject(["one", "a"], ["two", "b"]), system: "system", user: "user", executor });
    expect(result).toEqual({ ok: false, content: "", error: "all configured synthesis providers failed" });
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("suppresses an identical primary and secondary provider-model pair", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: false, content: "", error: "unavailable" });
    await executeSynthesisBroker({ projectId: configuredProject(["custom", "same"], ["custom", "same"]), system: "system", user: "user", executor });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("uses the server-resolved Zen default when no valid managed synthesis pair remains", async () => {
    const executor = vi.fn().mockResolvedValue({ ok: true, content: "zen" });
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      all: [{
        id: "opencode",
        name: "OpenCode Zen",
        models: {
          zen: {
            id: "opencode/zen-free",
            status: "active",
            cost: { input: 0, output: 0 },
          },
        },
      }],
      default: { opencode: "opencode/zen-free" },
    });

    const projectId = configuredProject(["removed-provider", "removed-model"]);
    settings.setSetting(projectId, "llm_provider_configs", "[]");
    const result = await executeSynthesisBroker({
      projectId,
      system: "system",
      user: "user",
      executor,
    });

    expect(result).toEqual({ ok: true, content: "zen" });
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      providerID: "opencode",
      modelID: "opencode/zen-free",
    }));
  });
});
