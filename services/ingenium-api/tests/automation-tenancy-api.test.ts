import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identity, jobs, organizations, projects, resetDbForTest, tasks } from "ingenium-core";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { jobsRouter } from "../lib/routes/jobs.js";
import { tasksRouter } from "../lib/routes/tasks.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory = "";
let server: Server;
let baseUrl = "";
let project: ReturnType<typeof projects.createProject>;
let ownerId = "";
let adminId = "";
let privateJobId = "";
let privateRunId = "";
let privateTaskId = "";
let organizationJobId = "";
let organizationTaskId = "";

function endpoint(resource: "jobs" | "tasks", path: string, userId: string): string {
  return `${baseUrl}/api/v1/${resource}${path}${path.includes("?") ? "&" : "?"}project=${project.name}&user=${userId}`;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-automation-tenancy-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  project = projects.createProject("automation-tenancy-api");
  ownerId = identity.createUser("automation-owner@example.test", "Automation Owner").id;
  adminId = identity.createUser("automation-admin@example.test", "Automation Admin").id;
  organizations.addOrganizationMember(project.organization_id, ownerId, "member");
  organizations.addOrganizationMember(project.organization_id, adminId, "admin");
  organizations.addProjectMember(project.id, ownerId, "editor");
  privateJobId = jobs.createJob(project.id, "Private job", undefined, "agent", "private prompt", undefined, undefined, undefined, undefined, {
    organizationId: project.organization_id,
    ownerUserId: ownerId,
    visibility: "private",
    actorType: "user",
    actorId: ownerId,
  }).id;
  organizationJobId = jobs.createJob(project.id, "Organization job", undefined, "agent", "shared prompt").id;
  const run = jobs.startJobRun(project.id, privateJobId, "manual", { delegator: { type: "user", id: ownerId } });
  if ("reason" in run) throw new Error(run.reason);
  privateRunId = run.id;
  privateTaskId = tasks.createTask(project.id, "Private task", undefined, undefined, undefined, {
    ownership: { organizationId: project.organization_id, ownerUserId: ownerId, visibility: "private", actorType: "user", actorId: ownerId },
  }).id;
  organizationTaskId = tasks.createTask(project.id, "Organization task").id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = { type: "user", id: String(req.query.user), scopes: ["user:*"] };
    next();
  });
  app.use(authorizationMiddleware);
  app.use("/api/v1/jobs", jobsRouter);
  app.use("/api/v1/tasks", tasksRouter);
  app.use(errorHandler);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("AUTH-106 private automation API", () => {
  it("creates authenticated jobs and tasks as private owner-scoped resources", async () => {
    const jobResponse = await fetch(endpoint("jobs", "", ownerId), json("POST", {
      name: "API private job",
      agent: "agent",
      prompt_template: "owner prompt",
    }));
    expect(jobResponse.status).toBe(201);
    const createdJob = (await jobResponse.json()).data as { id: string; owner_user_id: string; visibility: string };
    expect(createdJob).toMatchObject({ owner_user_id: ownerId, visibility: "private" });
    expect((await fetch(endpoint("jobs", `/${createdJob.id}`, adminId))).status).toBe(404);

    const taskResponse = await fetch(endpoint("tasks", "", ownerId), json("POST", { title: "API private task" }));
    expect(taskResponse.status).toBe(201);
    const createdTask = (await taskResponse.json()).data as { id: string; owner_user_id: string; visibility: string };
    expect(createdTask).toMatchObject({ owner_user_id: ownerId, visibility: "private" });
    expect((await fetch(endpoint("tasks", `/${createdTask.id}`, adminId))).status).toBe(404);
  });

  it("keeps private jobs and run metadata owner-only while organization jobs remain visible", async () => {
    const adminList = await fetch(endpoint("jobs", "", adminId));
    const adminJobIds = (await adminList.json()).data.map((job: { id: string }) => job.id);
    expect(adminJobIds).toContain(organizationJobId);
    expect(adminJobIds).not.toContain(privateJobId);
    expect((await fetch(endpoint("jobs", `/${privateJobId}`, adminId))).status).toBe(404);
    expect((await fetch(endpoint("jobs", `/${privateJobId}/runs`, adminId))).status).toBe(404);
    expect((await fetch(endpoint("jobs", `/runs/${privateRunId}/cancel`, adminId), { method: "POST" })).status).toBe(404);
    expect((await fetch(endpoint("jobs", `/${privateJobId}`, adminId), json("PATCH", { name: "stolen", expected_revision: 0 }))).status).toBe(404);

    expect((await fetch(endpoint("jobs", `/${privateJobId}`, ownerId))).status).toBe(200);
    expect((await fetch(endpoint("jobs", `/${privateJobId}/runs`, ownerId))).status).toBe(200);
  });

  it("keeps private tasks and child surfaces owner-only while organization tasks remain visible", async () => {
    const adminList = await fetch(endpoint("tasks", "", adminId));
    const adminTaskIds = (await adminList.json()).data.map((task: { id: string }) => task.id);
    expect(adminTaskIds).toContain(organizationTaskId);
    expect(adminTaskIds).not.toContain(privateTaskId);
    expect((await fetch(endpoint("tasks", `/${privateTaskId}`, adminId))).status).toBe(404);
    expect((await fetch(endpoint("tasks", `/${privateTaskId}/comments`, adminId))).status).toBe(404);
    expect((await fetch(endpoint("tasks", `/${privateTaskId}/references`, adminId))).status).toBe(404);
    expect((await fetch(endpoint("tasks", "/bulk", adminId), json("POST", { task_ids: [privateTaskId], priority: 9 }))).status).toBe(404);

    expect((await fetch(endpoint("tasks", `/${privateTaskId}`, ownerId))).status).toBe(200);
    expect((await fetch(endpoint("tasks", `/${privateTaskId}`, ownerId), json("PATCH", { title: "Owner update" }))).status).toBe(200);
  });
});
