import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const catalog = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../lib/job-native-provider.js", () => ({ getNativeJobProviderCatalog: catalog.get }));
vi.mock("../lib/job-runner.js", () => ({ executeJobRun: vi.fn(), killRunProcess: vi.fn() }));
vi.mock("ingenium-core", async (original) => {
  const core = await original<typeof import("ingenium-core")>();
  return { ...core, authentication: { ...core.authentication,
    hasRecentStepUp: (session: { testRecent?: boolean }) => session.testRecent === true } };
});
import { agents, getDb, identity, jobs, jobProviders, organizations, projects, resetDbForTest } from "ingenium-core";
import { jobsRouter } from "../lib/routes/jobs.js";
import { policyForRequest } from "../lib/authorization-policy.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let root: string; let server: Server; let url: string;
let project: ReturnType<typeof projects.createProject>; let job: ReturnType<typeof jobs.createJob>;
let adminId: string; let editorId: string;
const freeCatalog = { providerId: "opencode", label: "Free Zen", source: "builtin" as const,
  models: [{ id: "beam-free", label: "Beam Free" }], defaultModel: "beam-free" };
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "ingenium-job-provider-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(root, "data.db");
  process.env.INGENIUM_HOME = root;
  resetDbForTest();
  project = projects.createProject("job-provider-api");
  adminId = identity.createUser("job-admin@example.test", "Admin").id;
  editorId = identity.createUser("job-editor@example.test", "Editor").id;
  organizations.addOrganizationMember(project.organization_id, adminId, "admin");
  organizations.addOrganizationMember(project.organization_id, editorId, "member");
  organizations.addProjectMember(project.id, editorId, "editor");
  agents.createAgent(project.id, "job-agent", "# Exact instructions", "Job agent", "execution", "subagent");
  job = jobs.createJob(project.id, "API response", undefined, "job-agent", "Response only", undefined, undefined, 1);
  catalog.get.mockReset().mockResolvedValue(freeCatalog);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const mode = req.headers["x-test-mode"] ?? "browser";
    req.principal = mode === "compatibility"
      ? { type: "compatibility", id: "legacy", scopes: ["*"] }
      : mode === "service" ? { type: "service", id: job.service_principal_id, scopes: ["*"] }
      : { type: "user", id: mode === "editor" ? editorId : adminId, scopes: ["*"],
        ...(mode === "token" ? {} : { session: { testRecent: mode !== "stale" } as never }) };
    req.authorizationPolicy = policyForRequest(req);
    next();
  });
  app.use("/api/v1/jobs", jobsRouter); app.use(errorHandler);
  server = createServer(app); url = await listenOnLoopback(server);
});
afterEach(async () => {
  await closeHttpServer(server); resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH; delete process.env.INGENIUM_HOME;
  rmSync(root, { recursive: true, force: true });
});
function request(method: string, body?: unknown, mode = "browser", id = job.id, projectName = project.name) {
  return fetch(url + "/api/v1/jobs/" + encodeURIComponent(id) + "/provider?project=" + encodeURIComponent(projectName), {
    method, headers: { "Content-Type": "application/json", "X-Test-Mode": mode },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe("Jobs native provider API", () => {
  it("configures the job-bound free provider and returns only metadata", async () => {
    const before = getDb().prepare("SELECT * FROM settings ORDER BY project_id, key").all();
    const response = await request("PUT", { expected_revision: 0, model_id: "beam-free" });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data.job.revision).toBe(1);
    expect(result.data.connection).toEqual({ kind: "anonymous", providerId: "opencode", modelId: "beam-free", authorized: true });
    expect(getDb().prepare("SELECT * FROM settings ORDER BY project_id, key").all()).toEqual(before);
    const metadata = await (await request("GET")).json();
    expect(metadata.data).toMatchObject({ catalogAvailable: true, agentAvailable: true, models: freeCatalog.models });
    expect(JSON.stringify(metadata)).not.toMatch(/credential_item_id|config_json|apiKey|baseURL|npm/);
  });
  it.each(["compatibility", "service", "token", "editor"])("denies %s provider configuration", async (mode) => {
    expect((await request("PUT", { expected_revision: 0, model_id: "beam-free" }, mode)).status).toBe(mode === "service" ? 404 : 403);
    expect(jobProviders.getJobProvider(project.id, job.id)).toBeNull();
  });
  it("requires fresh browser step-up before any grant mutation", async () => {
    const response = await request("PUT", { expected_revision: 0, model_id: "beam-free" }, "stale");
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("STEP_UP_REQUIRED");
    expect(catalog.get).not.toHaveBeenCalled();
  });
  it.each([
    { expected_revision: 0, model_id: "paid-model" },
    { expected_revision: 0, model_id: "beam-free", providerId: "foreign" },
    { expected_revision: 0, model_id: "beam-free", baseURL: "https://example.test" },
    { expected_revision: 0, model_id: "beam-free", apiKey: "canary-not-a-real-key" },
    { model_id: "beam-free" },
  ])("rejects unavailable selections and extra fields (%j)", async (body) => {
    expect((await request("PUT", body)).status).toBe(422);
    expect(jobProviders.getJobProvider(project.id, job.id)).toBeNull();
  });
  it("fails closed without a catalog but permits explicit revocation during an outage", async () => {
    expect((await request("PUT", { expected_revision: 0, model_id: "beam-free" })).status).toBe(200);
    catalog.get.mockResolvedValue(null);
    expect((await request("PUT", { expected_revision: 1, model_id: "beam-free" })).status).toBe(503);
    expect((await request("PUT", { expected_revision: 1, model_id: null })).status).toBe(200);
    expect(jobProviders.getJobProvider(project.id, job.id)?.authorized).toBe(false);
  });
  it("rejects stale revisions and active runs without replacing their grants", async () => {
    await request("PUT", { expected_revision: 0, model_id: "beam-free" });
    expect((await request("PUT", { expected_revision: 0, model_id: null })).status).toBe(409);
    const run = jobs.startJobRun(project.id, job.id, "manual");
    if ("reason" in run) throw new Error(run.reason);
    expect((await request("PUT", { expected_revision: 1, model_id: null })).status).toBe(409);
    expect(jobProviders.getJobProvider(project.id, job.id)?.authorized).toBe(true);
  });
  it("does not expose or configure a job through another project", async () => {
    projects.createProject("foreign-job-project");
    expect((await request("GET", undefined, "browser", job.id, "foreign-job-project")).status).toBe(404);
    expect((await request("PUT", { expected_revision: 0, model_id: "beam-free" }, "browser", job.id, "foreign-job-project")).status).toBe(404);
  });
  it("rejects a disabled project agent", async () => {
    agents.disableAgent(project.id, job.agent);
    expect((await request("PUT", { expected_revision: 0, model_id: "beam-free" })).status).toBe(422);
    expect(jobProviders.getJobProvider(project.id, job.id)).toBeNull();
  });
  it("applies browser-only step-up policy to Express case/trailing-slash variants", () => {
    for (const path of ["/api/v1/jobs/id/provider", "/api/v1/jobs/id/provider/", "/api/v1/JOBS/id/PROVIDER/"]) {
      expect(policyForRequest({ method: "PUT", path })).toMatchObject({
        action: "jobs.provider.configure", permission: "admin", target: "project", browserSessionOnly: true, stepUp: true,
      });
    }
  });
});
