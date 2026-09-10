import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { projects, docs, tasks } from "ingenium-core";
import { servicesRouter } from "../lib/routes/services.js";

const emailMocks = vi.hoisted(() => ({
  getGlobalProjectId: vi.fn(),
  listAccounts: vi.fn(),
  getEngineStatus: vi.fn(),
}));
const runtimeManagerMocks = vi.hoisted(() => ({ health: vi.fn(async () => true) }));

vi.mock("ingenium-email", () => emailMocks);
vi.mock("../lib/runtime-manager-client.js", () => ({ runtimeManagerHealth: runtimeManagerMocks.health }));

let tempDir: string;
let globalProjectId: string;
let server: Server | null = null;
let supervisorServer: Server | null = null;
let baseUrl: string;
const originalSupervisorServerUrl = process.env.SUPERVISOR_SERVER_URL;
const originalDeploymentMode = process.env.INGENIUM_DEPLOYMENT_MODE;
const defaultSupervisorProcesses = [
  "restore-maintenance",
  "restore-handoff",
  "ingenium-api",
  "ingenium-api-boundary",
  "ingenium-dashboard",
  "ingenium-gateway",
];
let supervisorProcesses = [...defaultSupervisorProcesses];
let supervisorStates = new Map<string, string>();
let malformedSupervisorResponse = false;
let supervisorRequests: string[] = [];

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&apos;",
    "\"": "&quot;",
  })[character]!);
}

function processStruct(name: string): string {
  const state = supervisorStates.get(name) ?? (name === "restore-maintenance" ? "STOPPED" : "RUNNING");
  return `<struct><member><name>name</name><value><string>${escapeXml(name)}</string></value></member><member><name>statename</name><value><string>${state}</string></value></member><member><name>start</name><value><i4>1</i4></value></member><member><name>now</name><value><i4>11</i4></value></member><member><name>spawnerr</name><value><string></string></value></member><member><name>pid</name><value><i4>1</i4></value></member><member><name>exitstatus</name><value><i4>0</i4></value></member><member><name>stop</name><value><i4>0</i4></value></member></struct>`;
}

function supervisorResponse(): string {
  return `<methodResponse><params><param><value><array><data>${supervisorProcesses.map((name) => `<value>${processStruct(name)}</value>`).join("")}</data></array></value></param></params></methodResponse>`;
}

function processInfoResponse(name: string): string {
  return `<methodResponse><params><param><value>${processStruct(name)}</value></param></params></methodResponse>`;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/services", servicesRouter);
  return app;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-services-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  process.env.INGENIUM_DEPLOYMENT_MODE = "control-plane";

  // getTasksStatus() calls tasks.listTasks("global-default"), but the FK
  // constraint on tasks.project_id REFERENCES projects(id) requires a UUID.
  // We create the project and store its UUID for creating test tasks.
  const project = projects.createProject("global-default");
  globalProjectId = project.id;

  const socketPath = join(tempDir, "supervisor.sock");
  supervisorServer = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      supervisorRequests.push(body);
      response.writeHead(200, { "Content-Type": "text/xml" });
      if (malformedSupervisorResponse) {
        response.end("malformed");
        return;
      }
      if (body.includes("supervisor.getAllProcessInfo")) {
        response.end(supervisorResponse());
        return;
      }
      const process = supervisorProcesses.find((name) => body.includes(`<string>${escapeXml(name)}</string>`));
      response.end(process ? processInfoResponse(process) : "<methodResponse/>");
    });
  });
  await new Promise<void>((resolve) => supervisorServer!.listen(socketPath, resolve));
  process.env.SUPERVISOR_SERVER_URL = `unix://${socketPath}`;

  // Start a local server for fetch-based testing
  const app = buildApp();
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

});

beforeEach(() => {
  supervisorProcesses = [...defaultSupervisorProcesses];
  supervisorStates = new Map();
  malformedSupervisorResponse = false;
  supervisorRequests = [];
  emailMocks.getGlobalProjectId.mockReturnValue(globalProjectId);
  emailMocks.listAccounts.mockReturnValue([]);
  emailMocks.getEngineStatus.mockReturnValue({
    running: false,
    heartbeatAt: null,
    accounts: [],
  });
});

afterAll(async () => {
  if (originalSupervisorServerUrl === undefined) delete process.env.SUPERVISOR_SERVER_URL;
  else process.env.SUPERVISOR_SERVER_URL = originalSupervisorServerUrl;
  if (originalDeploymentMode === undefined) delete process.env.INGENIUM_DEPLOYMENT_MODE;
  else process.env.INGENIUM_DEPLOYMENT_MODE = originalDeploymentMode;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (supervisorServer) await new Promise<void>((resolve) => supervisorServer!.close(() => resolve()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /api/v1/services/status — applications", () => {
  it("reports five running production processes plus a safe stopped restore-maintenance program", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services).toHaveLength(6);
    expect(body.data.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "ingenium-api", state: "running", port: 4096, uptime: 10, required: true }),
      expect.objectContaining({ name: "restore-maintenance", state: "stopped", port: 0, required: false }),
    ]));
    expect(body.data.overall).toBe("healthy");
  });

  it("returns all control-plane applications in the response", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("data");
    expect(body.data).toHaveProperty("applications");
    expect(Array.isArray(body.data.applications)).toBe(true);
    expect(body.data.applications).toHaveLength(5);

    const names = body.data.applications.map((a: { name: string }) => a.name).sort();
    expect(names).toEqual(["docs-workspace", "email-client", "runtime-manager", "synthesis-engine", "tasks-board"]);
  });

  it("keeps aggregate health healthy when no optional email accounts exist", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const emailApp = body.data.applications.find(
      (app: { name: string }) => app.name === "email-client",
    );
    expect(emailApp).toMatchObject({ state: "idle", required: false });
    expect(body.data.overall).toBe("healthy");
  });

  it("degrades aggregate health when a required Supervisor process stops", async () => {
    supervisorStates.set("ingenium-dashboard", "STOPPED");

    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    const body = await res.json();

    expect(body.data.services).toContainEqual(expect.objectContaining({ name: "ingenium-dashboard", state: "stopped", required: true }));
    expect(body.data.overall).toBe("degraded");
  });

  it("degrades aggregate health when a required Supervisor process is missing", async () => {
    supervisorProcesses = supervisorProcesses.filter((name) => name !== "ingenium-dashboard");

    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    const body = await res.json();

    expect(body.data.services).toContainEqual(expect.objectContaining({ name: "ingenium-dashboard", state: "stopped", required: true }));
    expect(body.data.overall).toBe("degraded");
  });

  it("returns a content-free down result for malformed Supervisor responses", async () => {
    malformedSupervisorResponse = true;

    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    const body = await res.json();

    expect(body.data).toMatchObject({ services: [], overall: "down", error: "Supervisor status unavailable" });
    expect(JSON.stringify(body)).not.toContain("malformed");
  });

  it("degrades aggregate health for a configured email client with a stale heartbeat", async () => {
    emailMocks.listAccounts.mockReturnValue([{ id: "mail-1" }]);
    emailMocks.getEngineStatus.mockReturnValue({
      running: true,
      heartbeatAt: new Date(Date.now() - 121_000).toISOString(),
      accounts: [{ accountId: "mail-1", email: "mail@example.com", folders: [] }],
    });

    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const emailApp = body.data.applications.find(
      (app: { name: string }) => app.name === "email-client",
    );
    expect(emailApp).toMatchObject({ state: "degraded", required: true });
    expect(emailApp.detail).toContain("Heartbeat stale");
    expect(body.data.overall).toBe("degraded");
  });

  it("docs-workspace is idle when no docs exist", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const docsApp = body.data.applications.find(
      (a: { name: string }) => a.name === "docs-workspace"
    );
    expect(docsApp).toBeDefined();
    expect(docsApp.state).toBe("idle");
    expect(docsApp.description).toContain("Documentation workspace");
    expect(docsApp.detail).toContain("No documents yet");
  });

  it("tasks-board is idle when no tasks exist", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const tasksApp = body.data.applications.find(
      (a: { name: string }) => a.name === "tasks-board"
    );
    expect(tasksApp).toBeDefined();
    expect(tasksApp.state).toBe("idle");
    expect(tasksApp.description).toContain("Task board");
    expect(tasksApp.detail).toContain("No tasks");
  });

  it("docs-workspace becomes healthy when docs exist", async () => {
    // Create a space and a page
    const space = docs.createSpace("Test Space", "test-space");
    docs.createPage(space.id, "Test Page", "test-page");

    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const docsApp = body.data.applications.find(
      (a: { name: string }) => a.name === "docs-workspace"
    );
    expect(docsApp).toBeDefined();
    expect(docsApp.state).toBe("healthy");
    expect(docsApp.description).toContain("2 space(s), 1 page(s)");
    expect(docsApp.detail).toContain("2 spaces, 1 pages");
  });

  it("tasks-board becomes healthy when tasks exist in global-default", async () => {
    // getTasksStatus() calls tasks.listTasks("global-default") but the FK
    // constraint requires a real project UUID. We create tasks under the
    // actual global-default project UUID so they're visible to the query.
    tasks.createTask(globalProjectId, "Task 1");
    tasks.createTask(globalProjectId, "Task 2");
    const inProgress = tasks.createTask(globalProjectId, "In Progress");
    tasks.moveTask(globalProjectId, inProgress.id, "in_progress");
    const review = tasks.createTask(globalProjectId, "Review");
    tasks.moveTask(globalProjectId, review.id, "review");
    const done = tasks.createTask(globalProjectId, "Done");
    tasks.moveTask(globalProjectId, done.id, "done");

    const res = await fetch(`${baseUrl}/api/v1/services/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const tasksApp = body.data.applications.find(
      (a: { name: string }) => a.name === "tasks-board"
    );
    expect(tasksApp).toBeDefined();
    expect(tasksApp.state).toBe("healthy");
    expect(tasksApp.description).toContain("5 task(s)");
    expect(tasksApp.detail).toContain("2 todo");
    expect(tasksApp.detail).toContain("1 in progress");
    expect(tasksApp.detail).toContain("1 in review");
    expect(tasksApp.detail).toContain("1 done");
  });
});

describe("GET /api/v1/services/applications/:name", () => {
  it("docs-workspace returns stats", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/applications/docs-workspace`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("data");
    expect(body.data.name).toBe("docs-workspace");
    expect(body.data.state).toBe("healthy");
    expect(body.data).toHaveProperty("stats");
    expect(body.data.stats).toHaveProperty("spaces");
    expect(body.data.stats).toHaveProperty("pages");
    expect(body.data.stats).toHaveProperty("drafts");
    expect(typeof body.data.stats.spaces).toBe("number");
    expect(typeof body.data.stats.pages).toBe("number");
  });

  it("tasks-board returns stats with byColumn", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/applications/tasks-board`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("data");
    expect(body.data.name).toBe("tasks-board");
    expect(body.data.state).toBe("healthy");
    expect(body.data).toHaveProperty("stats");
    expect(body.data.stats).toHaveProperty("total");
    expect(body.data.stats).toHaveProperty("byColumn");
    expect(typeof body.data.stats.total).toBe("number");
    expect(body.data.stats.total).toBeGreaterThanOrEqual(5);

    // Verify byColumn breakdown
    const byColumn = body.data.stats.byColumn;
    expect(byColumn).toHaveProperty("todo");
    expect(byColumn).toHaveProperty("in_progress");
    expect(byColumn).toHaveProperty("review");
    expect(byColumn).toHaveProperty("done");
    expect(byColumn.todo).toBeGreaterThanOrEqual(2);
    expect(byColumn.in_progress).toBeGreaterThanOrEqual(1);
    expect(byColumn.review).toBeGreaterThanOrEqual(1);
    expect(byColumn.done).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 for unknown application", async () => {
    const res = await fetch(`${baseUrl}/api/v1/services/applications/unknown-app`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("Unknown application");
  });
});

describe("GET /api/v1/services/:name", () => {
  it("uses a valid getProcessInfo envelope for every process returned by aggregate status", async () => {
    const aggregate = await fetch(`${baseUrl}/api/v1/services/status`);
    const services = (await aggregate.json()).data.services as Array<{ name: string }>;

    for (const service of services) {
      const response = await fetch(`${baseUrl}/api/v1/services/${encodeURIComponent(service.name)}`);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ processName: expect.any(String) });
    }

    const detailRequests = supervisorRequests.filter((request) => request.includes("supervisor.getProcessInfo"));
    expect(detailRequests).toHaveLength(services.length);
    for (const request of detailRequests) {
      expect(request).toMatch(/<methodName>supervisor\.getProcessInfo<\/methodName><params><param><value><string>[^<]+<\/string><\/value><\/param><\/params><\/methodCall>/);
      expect(request).not.toContain("</methodName></params>");
    }
  });

  it("rejects names absent from aggregate status with a typed error", async () => {
    const response = await fetch(`${baseUrl}/api/v1/services/not-a-supervisor-process`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PROCESS_NOT_FOUND", message: "Process not found" },
    });
    expect(supervisorRequests.some((request) => request.includes("supervisor.getProcessInfo"))).toBe(false);
  });

  it("escapes a whitelisted supervisor process name in the XML request", async () => {
    const name = "worker & <unsafe> \"quoted\"";
    supervisorProcesses = [name];

    const response = await fetch(`${baseUrl}/api/v1/services/${encodeURIComponent(name)}`);
    expect(response.status).toBe(200);
    expect((await response.json()).data.processName).toBe(name);

    const request = supervisorRequests.find((candidate) => candidate.includes("supervisor.getProcessInfo"));
    expect(request).toContain(`<string>${escapeXml(name)}</string>`);
    expect(request).not.toContain(`<string>${name}</string>`);
  });
});
