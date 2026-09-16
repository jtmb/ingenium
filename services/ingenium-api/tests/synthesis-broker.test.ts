import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, identity, mcpCredentials, observations, organizations, projects, resetDbForTest, runtimes, settings, synthesis } from "ingenium-core";
import { createBackgroundSynthesisBrokerExecutor, executeSynthesisBroker, opencodeClient } from "../lib/opencode-client.js";

const temporaryPaths: string[] = [];

function configuredProject(primary?: [string, string], secondary?: [string, string]): string {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-synthesis-broker-"));
  temporaryPaths.push(directory);
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "test.db");
  resetDbForTest();
  const project = projects.createProject(`broker-${Date.now()}-${Math.random()}`);
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
): runtimes.RuntimeInstance {
  const project = projects.listProjects().find((candidate) => candidate.id === projectId)!;
  organizations.addOrganizationMember(project.organization_id, owner.id, "member");
  const workspaceId = `workspace-${crypto.randomUUID()}`;
  const storagePath = `/srv/approved/${workspaceId}`;
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
  if (authorizeAutomation) {
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO automation_principal_grants
      (id, organization_id, project_id, service_principal_id, permission, granted_by_actor_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'execute', 'system', ?, ?)`)
      .run(crypto.randomUUID(), project.organization_id, projectId, credential.servicePrincipalId, now, now);
  }
  for (const toState of ["PROVISIONING", "STARTING", "READY"] as const) {
    runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState, actorType: "system", actorId: "test" });
  }
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
  it("returns an actionable unavailable result without probing providers when no authorized executor exists", async () => {
    const projectId = configuredProject();
    const providers = vi.spyOn(opencodeClient, "listProviders");

    await expect(createBackgroundSynthesisBrokerExecutor(projectId)({
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

  it("never sends a victim-private observation to another member's runtime or the global OpenCode target", async () => {
    const canary = "VICTIM_PRIVATE_SYNTHESIS_CANARY";
    const projectId = configuredProject(["custom", "model-a"]);
    const project = projects.listProjects().find((candidate) => candidate.id === projectId)!;
    const victim = identity.createUser(`victim-${crypto.randomUUID()}@example.test`, "Victim");
    const attacker = identity.createUser(`attacker-${crypto.randomUUID()}@example.test`, "Attacker");
    organizations.addOrganizationMember(project.organization_id, victim.id, "member");
    activateRuntime(projectId, attacker);
    observations.storeObservation(projectId, "preference", canary, 10, "manual", undefined, undefined, {
      organizationId: project.organization_id,
      ownerUserId: victim.id,
      visibility: "private",
    });
    const fetchMock = vi.fn();
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-password");
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesis.runSynthesis(projectId, undefined, {
      llmExecutor: createBackgroundSynthesisBrokerExecutor(projectId),
    });

    expect(result.summary).toContain("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(canary);
  });

  it("executes background synthesis through an explicitly authorized automation runtime", async () => {
    const projectId = configuredProject(["custom", "model-a"]);
    const runtime = activateRuntime(projectId, undefined, true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ id: "broker-session", title: "Broker" }))
      .mockResolvedValueOnce(response({ info: { id: "user", role: "user" }, parts: [] }))
      .mockResolvedValueOnce(response([{ info: { id: "assistant", role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "done" }] }]))
      .mockResolvedValueOnce(response(true));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createBackgroundSynthesisBrokerExecutor(projectId)({
      system: "system",
      user: "user",
      timeoutMs: 1_000,
    })).resolves.toEqual({ ok: true, content: "done" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith(`http://${runtime.backendName}:4098`))).toBe(true);
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
