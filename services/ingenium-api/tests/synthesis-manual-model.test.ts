import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import express from "express";
import { authentication, maintenanceLocks, projects, resetDbForTest, runtimes, settings, synthesis } from "ingenium-core";
import { synthesisRouter } from "../lib/routes/synthesis.js";
import { getManualSynthesisModels } from "../lib/manual-synthesis-models.js";
import { createBackgroundSynthesisBrokerExecutor } from "../lib/opencode-client.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

vi.mock("../lib/manual-synthesis-models.js", () => ({ getManualSynthesisModels: vi.fn() }));
vi.mock("../lib/opencode-client.js", () => ({ createBackgroundSynthesisBrokerExecutor: vi.fn() }));

let directory: string;
let server: Server;
let base: string;
let projectId: string;
const choice = { providerId: "openai", modelId: "gpt-6-luna" };

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-manual-synthesis-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "test.db"));
  resetDbForTest();
  projectId = projects.createProject("manual-synthesis").id;
  settings.setSetting(projectId, "chat_selection", JSON.stringify({ providerId: "opencode", modelId: "beam-free" }));
  vi.spyOn(runtimes, "getReadyRuntimeForProject").mockReturnValue({ id: "fixture-runtime", ownerUserId: "test-user" } as ReturnType<typeof runtimes.getReadyRuntimeForProject>);
  vi.mocked(getManualSynthesisModels).mockResolvedValue({ providers: [{
    providerId: "openai", label: "OpenAI", source: "builtin", defaultModel: choice.modelId,
    models: [{ id: choice.modelId, label: "Luna" }],
  }], unavailable: false });
  vi.mocked(createBackgroundSynthesisBrokerExecutor).mockReturnValue(async () => ({ ok: true, content: "{}" }));
  vi.spyOn(synthesis, "runSynthesis").mockResolvedValue({ summary: "test complete" } as Awaited<ReturnType<typeof synthesis.runSynthesis>>);
  const app = express();
  app.use(express.json());
  // The real auth/CSRF middleware owns session verification. This route harness
  // supplies its already-verified principal to test the additional choice gate.
  app.use((req, _res, next) => {
    if (req.header("x-test-auth") === "browser") req.principal = {
      type: "user", id: "test-user", scopes: [], session: { id: "fixture" } as authentication.AuthSession,
    };
    if (req.header("x-test-auth") === "token") req.principal = { type: "user", id: "test-user", scopes: [], tokenId: "fixture" };
    if (req.header("x-test-auth") === "service") req.principal = {
      type: "service", id: "test-service", scopes: [], tokenId: "fixture", organizationId: null, projectId,
    };
    next();
  });
  app.use("/api/v1/synthesis", synthesisRouter);
  server = createServer(app);
  base = await listenOnLoopback(server);
});

afterEach(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function run(body?: unknown, auth = "browser", suffix = "") {
  return fetch(`${base}/api/v1/synthesis/run?project=manual-synthesis${suffix}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-test-auth": auth },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("manual synthesis model selection", () => {
  it("keeps the default path and persisted selection unchanged without reading the optional catalog", async () => {
    const before = settings.getSetting(projectId, "chat_selection");
    expect((await run()).status).toBe(200);
    expect(getManualSynthesisModels).not.toHaveBeenCalled();
    expect(createBackgroundSynthesisBrokerExecutor).toHaveBeenCalledWith(projectId, undefined);
    expect(settings.getSetting(projectId, "chat_selection")).toBe(before);
  });

  it("passes only the catalog-validated choice for this run, then returns to the configured path", async () => {
    const before = settings.getSetting(projectId, "chat_selection");
    expect((await run({ model: choice })).status).toBe(200);
    expect(createBackgroundSynthesisBrokerExecutor).toHaveBeenCalledWith(projectId, { providerID: "openai", modelID: "gpt-6-luna", runtimeId: "fixture-runtime", ownerUserId: "test-user" });
    await vi.waitFor(() => expect(maintenanceLocks.getLockStatus("skills", projectId)).toBeUndefined());
    expect((await run()).status).toBe(200);
    expect(createBackgroundSynthesisBrokerExecutor).toHaveBeenLastCalledWith(projectId, undefined);
    expect(settings.getSetting(projectId, "chat_selection")).toBe(before);
    expect(settings.getSetting(projectId, "synthesis_model")).toBeUndefined();
  });

  it.each(["none", "token", "service"])("rejects an override from %s authentication before catalog lookup or execution", async (auth) => {
    expect((await run({ model: choice }, auth)).status).toBe(403);
    expect(getManualSynthesisModels).not.toHaveBeenCalled();
    expect(synthesis.runSynthesis).not.toHaveBeenCalled();
    expect(maintenanceLocks.getLockStatus("skills", projectId)).toBeUndefined();
  });

  it.each(["absent", "another-user"])("rejects a browser override when the authorized runtime is %s", async (owner) => {
    vi.mocked(runtimes.getReadyRuntimeForProject).mockReturnValue(owner === "absent" ? undefined : { ownerUserId: owner } as ReturnType<typeof runtimes.getReadyRuntimeForProject>);
    expect((await run({ model: choice })).status).toBe(403);
    expect(getManualSynthesisModels).not.toHaveBeenCalled();
    expect(synthesis.runSynthesis).not.toHaveBeenCalled();
  });

  it.each([null, {}, { providerId: "openai", modelId: "missing" }, { ...choice, endpoint: "https://untrusted.invalid" }, { ...choice, modelId: "sk-secret123456789" }])(
    "rejects malformed, unavailable, injected or secret-shaped model input %j", async (model) => {
      expect((await run({ model })).status).toBe(422);
      expect(synthesis.runSynthesis).not.toHaveBeenCalled();
      expect(maintenanceLocks.getLockStatus("skills", projectId)).toBeUndefined();
    },
  );

  it.each(["unavailable", "throws"])("fails closed when the current catalog %s", async (mode) => {
    if (mode === "throws") vi.mocked(getManualSynthesisModels).mockRejectedValue(new Error("private provider diagnostic"));
    else vi.mocked(getManualSynthesisModels).mockResolvedValue({ providers: [], unavailable: true });
    const response = await run({ model: choice });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private provider diagnostic");
    expect(synthesis.runSynthesis).not.toHaveBeenCalled();
  });

  it("validates session identifiers without an unhandled async rejection", async () => {
    expect((await run(undefined, "browser", "&session_id=bad%2Fpath")).status).toBe(422);
    expect(synthesis.runSynthesis).not.toHaveBeenCalled();
  });

  it("preserves the existing per-project lock when a manual run is already in flight", async () => {
    const owner = maintenanceLocks.generateOwnerToken();
    maintenanceLocks.acquireLock("skills", projectId, owner, 30_000);
    expect((await run({ model: choice })).status).toBe(423);
    expect(synthesis.runSynthesis).not.toHaveBeenCalled();
    expect(maintenanceLocks.getLockStatus("skills", projectId)?.owner_token).toBe(owner);
    maintenanceLocks.releaseLock("skills", projectId, owner);
  });
});
