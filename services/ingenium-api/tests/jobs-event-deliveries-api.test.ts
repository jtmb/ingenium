import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contextConversations,
  jobEventDeliveries,
  jobs,
  projects,
  resetDbForTest,
} from "ingenium-core";
import { jobsRouter } from "../lib/routes/jobs.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory = "";
let server: Server;
let baseUrl = "";
let firstProjectId = "";
let runId = "";
let eventJobId = "";

const firstProject = "event-api-first";
const secondProject = "event-api-second";

function emitArchive(projectId: string): void {
  const conversation = contextConversations.createContextConversation(projectId, { title: "API event fixture" });
  contextConversations.appendContextMessage(projectId, conversation.id, {
    role: "user", content: "No payload is exposed by jobs API.", expectedRevision: 0,
  });
  const authorization = contextConversations.authorizeContextMaintenanceAction(projectId, conversation.id, {
    operation: "archive_conversation", expectedRevision: 1,
  });
  contextConversations.archiveContextConversation(projectId, conversation.id, {
    expectedRevision: 1, confirmationToken: authorization.confirmationToken,
  });
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-jobs-event-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  firstProjectId = projects.createProject(firstProject).id;
  const secondProjectId = projects.createProject(secondProject).id;
   const eventJob = jobs.createJob(firstProjectId, "Archive handler", undefined, "agent", "prompt=not-exposed", undefined, "context.conversation.archived");
   eventJobId = eventJob.id;
  jobs.createJob(secondProjectId, "Foreign handler", undefined, "agent", "prompt", undefined, "context.conversation.archived");
  emitArchive(firstProjectId);
  emitArchive(firstProjectId);
  jobEventDeliveries.snapshotTrustedJobEvents(firstProjectId);
  const manual = jobs.createJob(firstProjectId, "Manual", undefined, "agent", "prompt");
  const run = jobs.startJobRun(firstProjectId, manual.id, "manual");
  if ("reason" in run) throw new Error(run.reason);
  runId = run.id;
  jobs.appendRunLog(firstProjectId, runId, "stdout", "token=do-not-return");
  jobs.finishJobRun(firstProjectId, runId, "success", 0);
  void eventJob;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/jobs", jobsRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("JOB-101 REST visibility and project isolation", () => {
  it("lists sanitized trusted-event and delivery metadata with bounded keyset pagination", async () => {
    const events = await fetch(`${baseUrl}/api/v1/jobs/events?project=${firstProject}&limit=1`);
    expect(events.status).toBe(200);
    const eventPage = await events.json();
    expect(eventPage.data).toHaveLength(1);
    expect(eventPage.data[0]).not.toHaveProperty("payload");
    expect(eventPage.nextCursor).toEqual(expect.any(String));

    const deliveries = await fetch(`${baseUrl}/api/v1/jobs/event-deliveries?project=${firstProject}&limit=1`);
    expect(deliveries.status).toBe(200);
    const deliveryPage = await deliveries.json();
    expect(deliveryPage.data).toHaveLength(1);
    expect(deliveryPage.data[0]).not.toHaveProperty("lease_owner_hash");
    expect(deliveryPage.data[0]).not.toHaveProperty("payload");
    const detail = await fetch(`${baseUrl}/api/v1/jobs/event-deliveries/${deliveryPage.data[0].id}?project=${firstProject}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).data.id).toBe(deliveryPage.data[0].id);

    expect((await fetch(`${baseUrl}/api/v1/jobs/events?project=${firstProject}&limit=101`)).status).toBe(422);
    expect((await fetch(`${baseUrl}/api/v1/jobs/event-deliveries?project=${firstProject}&limit=101`)).status).toBe(422);
  });

  it("returns 404 rather than cross-project run, log, cancel, or delivery access", async () => {
    const delivery = jobEventDeliveries.listJobEventDeliveries(firstProjectId, { limit: 1 }).data[0]!;
    expect((await fetch(`${baseUrl}/api/v1/jobs/event-deliveries/${delivery.id}?project=${secondProject}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/v1/jobs/runs/${runId}/logs?project=${secondProject}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/v1/jobs/runs/${runId}/cancel?project=${secondProject}`, { method: "POST" })).status).toBe(404);
    const ownLogs = await fetch(`${baseUrl}/api/v1/jobs/runs/${runId}/logs?project=${firstProject}`);
    expect(ownLogs.status).toBe(200);
    expect((await ownLogs.json()).data[0].line).toBe("token=[REDACTED]");
  });

  it("rejects deletion while an event attempt is leased, then permits terminal cleanup", async () => {
    const claim = jobEventDeliveries.claimJobEventDelivery(firstProjectId)!;
    const blocked = await fetch(`${baseUrl}/api/v1/jobs/${eventJobId}?project=${firstProject}`, {
      method: "DELETE",
      body: JSON.stringify({ expected_revision: 0 }),
      headers: { "content-type": "application/json" },
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      error: { code: "JOB_ACTIVE_DELIVERY", message: "Job has an active event delivery" },
    });
    expect(jobEventDeliveries.getJobEventDelivery(firstProjectId, claim.delivery.id)).toMatchObject({ state: "leased" });

    jobEventDeliveries.completeJobEventDelivery(firstProjectId, {
      deliveryId: claim.delivery.id,
      attemptNumber: claim.attemptNumber,
      runId: claim.run.id,
      leaseToken: claim.leaseToken,
      leaseRevision: claim.leaseRevision,
      outcome: "cancelled",
      exitCode: -1,
      errorCode: "cancelled",
      errorMessage: "Cancelled before delete.",
    });
    expect((await fetch(`${baseUrl}/api/v1/jobs/${eventJobId}?project=${firstProject}`, {
      method: "DELETE",
      body: JSON.stringify({ expected_revision: 0 }),
      headers: { "content-type": "application/json" },
    })).status).toBe(204);
    expect(jobEventDeliveries.getJobEventDelivery(firstProjectId, claim.delivery.id)).toMatchObject({ state: "dead_letter" });
  });
});
