import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extraction, observations, projects, resetDbForTest, settings, synthesisLlm } from "ingenium-core";
import * as endpointPolicy from "ingenium-core/lib/tools/endpoint-policy";
import { extractionRouter } from "../lib/routes/extraction.js";
import * as opencodeClient from "../lib/opencode-client.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory: string;
let server: Server;
let baseUrl: string;
let projectId: string;
let principal: any;
const nativeSessionId = "ses-external";
const input = { worktree: "/home/brajam/repos/ingenium", sessionId: `session-${createHash("sha256").update(nativeSessionId, "utf8").digest("hex")}` };
const bindingRejected = { error: { code: "EXTERNAL_OBSERVATION_BINDING_REJECTED", message: "OpenCode session binding rejected" } };

beforeEach(async () => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-external-api-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "test.db"));
  const project = projects.createProject("ingenium-external-api");
  projectId = project.id;
  principal = { type: "service", id: "learning-service", tokenId: "learning-token", scopes: ["extraction:write"], audience: "mcp",
    organizationId: project.organization_id, projectId, projectIds: [projectId], workspaceId: "workspace-external",
    launcherWorktree: input.worktree, storageMappingHash: "a".repeat(64) };
  vi.spyOn(opencodeClient, "verifyOpenCodeNativeMessage").mockImplementation(async ({ sessionId }) =>
    sessionId === input.sessionId ? { nativeSessionId } : bindingRejected);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.principal = principal; next(); });
  app.use("/api/v1/extraction", extractionRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function post(external: unknown, project = "ingenium-external-api") {
  const response = await fetch(`${baseUrl}/api/v1/extraction/run?project=${project}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ external }),
  });
  return { status: response.status, body: await response.json() };
}

describe("external observation API binding", () => {
  it("ingests a short preference through the direct extractor once and returns only receipt metadata", async () => {
    vi.spyOn(synthesisLlm, "getFullLLMSynthesisConfig").mockReturnValue({ model: "test", endpoint: "https://extractor.example.test" });
    const llm = vi.spyOn(endpointPolicy, "safeLlmFetch").mockResolvedValue(new Response(JSON.stringify({ choices: [
      { message: { content: JSON.stringify({ rules: [{ type: "preference", content: "User prefers concise replies." }] }) } },
    ] }), { status: 200 }));
    const external = { ...input, message: { id: "msg-user", role: "user", text: "I prefer concise replies." } };
    const first = await post(external);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ created: true, enabled: true });
    expect((await post(external)).body.data).toEqual({ ...first.body.data, created: false });
    expect(llm).toHaveBeenCalledOnce();
    expect(observations.getObservations(projectId)).toHaveLength(1);
    expect(JSON.stringify(first.body)).not.toContain("prefers");
    expect((await post({ ...external, message: { ...external.message, text: "I prefer verbose replies." } })).status).toBe(409);
  });

  it("probes the registered exact session and honors disabled learning without invoking an extractor", async () => {
    expect(await post(input)).toEqual({ status: 200, body: { data: { enabled: true, created: false, observationId: null } } });
    settings.setSetting(projectId, "automatic_learning_enabled", "false");
    expect((await post({ ...input, message: { id: "msg-user", role: "user", text: "I prefer concise answers in every future session." } })).body.data.enabled).toBe(false);
    expect(observations.getObservations(projectId)).toHaveLength(0);
  });

  it("rejects unknown session, foreign project/worktree, absent principal and assistant/operational payloads", async () => {
    expect((await post({ ...input, sessionId: "unknown" })).status).toBe(403);
    expect((await post({ ...input, worktree: "/foreign" })).status).toBe(403);
    projects.createProject("foreign");
    expect((await post(input, "foreign")).status).toBe(403);
    expect((await post({ ...input, message: { id: "msg", role: "assistant", text: "I prefer concise responses." } })).status).toBe(422);
    expect((await post({ ...input, metadata: "operational-canary" })).status).toBe(422);
    principal = undefined;
    expect((await post(input)).status).toBe(403);
  });

  it("fails closed without a non-persisting extractor and sanitizes unexpected errors", async () => {
    const message = { id: "msg-user", role: "user", text: "I prefer concise answers in every future session." };
    expect((await post({ ...input, message })).status).toBe(503);
    vi.spyOn(extraction, "extractExternalObservation").mockRejectedValue(new Error("Bearer error-canary"));
    const result = await post(input);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("error-canary");
  });
});
