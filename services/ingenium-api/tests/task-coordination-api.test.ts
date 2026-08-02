import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest, tasks } from "ingenium-core";
import { tasksRouter } from "../lib/routes/tasks.js";

let directory = "";
let server: Server;
let baseUrl = "";
let alpha: ReturnType<typeof projects.createProject>;
let beta: ReturnType<typeof projects.createProject>;
let alphaTask = "";
let betaTask = "";

function endpoint(path: string, project = alpha.name): string {
  return `${baseUrl}/api/v1/tasks${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`;
}

async function json(path: string, init: RequestInit = {}, project = alpha.name) {
  const response = await fetch(endpoint(path, project), init);
  return { response, body: response.status === 204 ? undefined : await response.json() };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-task-coordination-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_HOME = join(directory, "home");
  resetDbForTest();
  alpha = projects.createProject("coord-api-alpha");
  beta = projects.createProject("coord-api-beta");
  alphaTask = tasks.createTask(alpha.id, "alpha task").id;
  betaTask = tasks.createTask(beta.id, "beta task").id;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/tasks", tasksRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_HOME;
  rmSync(directory, { recursive: true, force: true });
});

describe("COORD-100 task API", () => {
  it("makes foreign task members indistinguishable from absent members", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const path of [
      `/${alphaTask}`,
      `/${alphaTask}/comments`,
      `/${alphaTask}/activity`,
      `/${alphaTask}/links`,
      `/${alphaTask}/tree`,
    ]) {
      const foreign = await json(path, {}, beta.name);
      const absent = await json(path.replace(alphaTask, missing));
      expect(foreign.response.status).toBe(absent.response.status);
      expect(foreign.response.status).toBe(404);
    }
    expect((await json(`/${alphaTask}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "foreign" }),
    }, beta.name)).response.status).toBe(404);
    expect((await json(`/${alphaTask}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "user", body: "foreign" }),
    }, beta.name)).response.status).toBe(404);
    expect((await json("/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_ids: [alphaTask, betaTask], priority: 9 }),
    })).response.status).toBe(404);
    expect(tasks.getTask(alpha.id, alphaTask)?.priority).toBe(0);
  });

  it("returns revisions and maps CAS, replay, mismatch, and header disagreement stably", async () => {
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "api-update-1" };
    const first = await json(`/${alphaTask}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "updated", expected_revision: 0 }),
    });
    expect(first.response.status).toBe(200);
    expect(first.body.data).toMatchObject({ title: "updated", revision: 1 });
    const replay = await json(`/${alphaTask}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "updated", expected_revision: 0 }),
    });
    expect(replay.response.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    const mismatch = await json(`/${alphaTask}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "changed", expected_revision: 1 }),
    });
    expect(mismatch).toMatchObject({ response: { status: 409 }, body: { error: { code: "IDEMPOTENCY_KEY_REUSED" } } });
    const stale = await json(`/${alphaTask}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: 3, expected_revision: 0 }),
    });
    expect(stale).toMatchObject({ response: { status: 409 }, body: { error: { code: "REVISION_CONFLICT", currentRevision: 1 } } });
    const disagreement = await json(`/${alphaTask}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ priority: 3, expected_revision: 1, idempotency_key: "different" }),
    });
    expect(disagreement).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_TASK_MUTATION_INPUT" } } });
  });

  it("accepts body idempotency for managed reservations without exposing tokens", async () => {
    const reservationToken = "0123456789abcdef0123456789abcdef";
    const missingIdempotency = await json(`/${alphaTask}/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: 1, owner: "agent-a", worktree: "worktree-a", reservation_token: reservationToken }),
    });
    expect(missingIdempotency).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_TASK_MUTATION_INPUT" } } });
    const disagreement = await json(`/${alphaTask}/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "api-reserve-header" },
      body: JSON.stringify({ expected_revision: 1, owner: "agent-a", worktree: "worktree-a", reservation_token: reservationToken, idempotency_key: "api-reserve-body" }),
    });
    expect(disagreement).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_TASK_MUTATION_INPUT" } } });
    const reserve = await json(`/${alphaTask}/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: 1, owner: "agent-a", worktree: "worktree-a", reservation_token: reservationToken, idempotency_key: "api-reserve-1" }),
    });
    expect(reserve).toMatchObject({ response: { status: 200 }, body: { data: { revision: 2, reservation_state: "reserved" } } });
    expect(JSON.stringify(reserve.body)).not.toContain("reservation_token_hash");
    expect(JSON.stringify(reserve.body)).not.toContain(reservationToken);
    const replay = await json(`/${alphaTask}/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: 1, owner: "agent-a", worktree: "worktree-a", reservation_token: reservationToken, idempotency_key: "api-reserve-1" }),
    });
    expect(replay.body.data).toEqual(reserve.body.data);
    const [detail, list] = await Promise.all([json(`/${alphaTask}`), json("/")]);
    expect(JSON.stringify(detail.body)).not.toContain("reservation_token_hash");
    expect(JSON.stringify(list.body)).not.toContain("reservation_token_hash");
    expect(JSON.stringify(replay.body)).not.toContain(reservationToken);
    const wrongOwner = await json(`/${alphaTask}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: 2, owner: "agent-a", worktree: "worktree-a", reservation_token: "fedcba9876543210fedcba9876543210", idempotencyKey: "api-release-1" }),
    });
    expect(wrongOwner).toMatchObject({ response: { status: 409 }, body: { error: { code: "RESERVATION_OWNER_MISMATCH" } } });
    expect(JSON.stringify(wrongOwner.body)).not.toContain("agent-a");
    expect(JSON.stringify(wrongOwner.body)).not.toContain("worktree-a");
  });

  it("applies bulk scalar revisions with per-task overrides and rejects stale or changed replays", async () => {
    const first = tasks.createTask(alpha.id, "bulk first");
    const second = tasks.createTask(alpha.id, "bulk second");
    tasks.updateTask(alpha.id, second.id, { priority: 1 });
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "api-bulk-scalar-map-1" };
    const body = {
      task_ids: [first.id, second.id],
      priority: 4,
      expected_revision: 0,
      expected_revisions: { [second.id]: 1 },
    };
    const applied = await json("/bulk", { method: "POST", headers, body: JSON.stringify(body) });
    expect(applied).toMatchObject({ response: { status: 200 }, body: { data: { updated: 2, revisions: { [first.id]: 1, [second.id]: 2 } } } });
    const stale = await json("/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(stale).toMatchObject({ response: { status: 409 }, body: { error: { code: "REVISION_CONFLICT" } } });
    const changedReplay = await json("/bulk", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, expected_revision: 1 }),
    });
    expect(changedReplay).toMatchObject({ response: { status: 409 }, body: { error: { code: "IDEMPOTENCY_KEY_REUSED" } } });
  });
});
