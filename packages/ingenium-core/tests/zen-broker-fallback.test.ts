import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProject } from "../lib/tools/projects.js";
import { runExtraction, type OpenCodeMessagesClient } from "../lib/tools/extraction.js";
import { runSynthesis } from "../lib/tools/synthesis.js";
import { getObservations, storeObservation } from "../lib/tools/observations.js";
import { getTraits } from "../lib/tools/personality.js";
import { resetDbForTest } from "../lib/db.js";
import type { LLMTextExecutor } from "../lib/tools/synthesis-llm.js";

let directory: string;
let server: Server;
let port: number;
const requestedProjects: string[] = [];
const calls: Array<{ system: string; timeoutMs: number }> = [];

const brokerFixture: LLMTextExecutor = async ({ system, user, timeoutMs }) => {
  calls.push({ system, timeoutMs });
  if (system.includes("DURABLE USER BEHAVIOR")) {
    return {
      ok: true,
      content: JSON.stringify({
        rules: [{
          content: "User prefers concise external-project reviews",
          type: "preference",
          importance: 8,
        }],
      }),
    };
  }
  if (system.includes("personality model consolidator")) {
    const observationId = Number(user.match(/\[id:(\d+)\]/)?.[1]);
    return {
      ok: true,
      content: JSON.stringify({
        create: [{
          trait_type: "workflow_pattern",
          trait_value: "User prefers concise external-project reviews",
          confidence_hint: 0.12,
          observation_ids: [observationId],
        }],
        confirm: [],
        ignore_count: 0,
      }),
    };
  }
  return {
    ok: true,
    content: JSON.stringify({
      skills_to_create: [],
      skills_to_update: [],
      personality_traits: [],
      insights: [],
      summary: "No skill proposal.",
    }),
  };
};

const fixtureMessagesClient: OpenCodeMessagesClient = async ({ since, limit, projectName }) => {
  const url = new URL("/api/v1/opencode/messages", `http://localhost:${port}`);
  url.searchParams.set("since", String(since));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("project", projectName);
  const response = await fetch(url);
  const payload = await response.json() as { data?: { messages?: unknown } };
  return { messages: Array.isArray(payload.data?.messages) ? payload.data.messages as any[] : [] };
};

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-zen-broker-fallback-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname === "/api/v1/opencode/messages") {
        requestedProjects.push(url.searchParams.get("project") ?? "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { messages: [{
          text: "I prefer concise external-project review summaries with clear actions.",
          time_created: Date.now(),
          hash: "zen-broker-message",
          messageId: "message-zen-1",
          sessionId: "session-zen-1",
        }] } }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
});

describe("Zen broker fallback acceptance", () => {
  it("keeps extraction, observations, and traits isolated to the external project without direct synthesis configuration", async () => {
    const external = createProject("zen-external-project");

    const extraction = await runExtraction(external.id, external.name, {
      limit: 10,
      llmExecutor: brokerFixture,
      messagesClient: fixtureMessagesClient,
    });
    const observation = getObservations(external.id).find(
      (item) => item.content === "User prefers concise external-project reviews",
    );
    expect(extraction).toMatchObject({ scanned: 1, candidates: 1, created: 1, failedBatches: 0 });
    expect(requestedProjects).toEqual([external.name]);
    expect(observation).toMatchObject({ project_id: external.id, source: "auto-observer" });

    const synthesis = await runSynthesis(external.id, undefined, { llmExecutor: brokerFixture });
    expect(synthesis).toMatchObject({ observations_processed: 1, traits_created: 1 });
    expect(getTraits(external.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        project_id: external.id,
        trait_value: "User prefers concise external-project reviews",
      }),
    ]));
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ system: expect.stringContaining("DURABLE USER BEHAVIOR"), timeoutMs: 60_000 }),
      expect.objectContaining({ system: expect.stringContaining("personality model consolidator"), timeoutMs: 60_000 }),
      expect.objectContaining({ system: expect.stringContaining("skill synthesis engine"), timeoutMs: 60_000 }),
    ]));
  });

  it("processes one controlled pending observation into a trait through the Zen fixture within its request budget", async () => {
    const external = createProject("zen-controlled-pending-project");
    const observation = storeObservation(
      external.id,
      "preference",
      "User prefers controlled Zen fixture synthesis coverage with bounded execution.",
      8,
      "manual",
    );
    const callsBefore = calls.length;

    const synthesis = await runSynthesis(external.id, undefined, { llmExecutor: brokerFixture });
    const observedCalls = calls.slice(callsBefore);

    expect(synthesis).toMatchObject({ observations_processed: 1, traits_created: 1 });
    expect(getObservations(external.id).find((item) => item.id === observation.id)).toMatchObject({
      status: "processed",
    });
    expect(getTraits(external.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trait_value: "User prefers concise external-project reviews",
      }),
    ]));
    expect(observedCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ system: expect.stringContaining("personality model consolidator"), timeoutMs: 60_000 }),
      expect.objectContaining({ system: expect.stringContaining("skill synthesis engine"), timeoutMs: 60_000 }),
    ]));
  });

  it("leaves a timed-out Zen consolidation observation pending for a later retry", async () => {
    const external = createProject("zen-timeout-retry-project");
    const observation = storeObservation(
      external.id,
      "preference",
      "User prefers bounded background synthesis retries after a temporary timeout.",
      8,
      "manual",
    );
    const timedOutZenFixture: LLMTextExecutor = async () => ({
      ok: false,
      content: "",
      error: "timeout",
    });

    const first = await runSynthesis(external.id, undefined, { llmExecutor: timedOutZenFixture });
    const second = await runSynthesis(external.id, undefined, { llmExecutor: timedOutZenFixture });
    const persisted = getObservations(external.id).find((item) => item.id === observation.id);

    expect(first.observations_processed).toBe(0);
    expect(second.observations_processed).toBe(0);
    expect(persisted).toMatchObject({ status: "pending" });
  });
});
