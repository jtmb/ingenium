import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  executeSynthesisBroker: vi.fn(),
  resolveSynthesisProviderSelections: vi.fn(),
}));

vi.mock("../lib/opencode-client.js", () => ({
  executeSynthesisBroker: mocks.executeSynthesisBroker,
}));

vi.mock("../lib/synthesis-provider-resolution.js", () => ({
  resolveSynthesisProviderSelections: mocks.resolveSynthesisProviderSelections,
}));

import { projects, resetDbForTest } from "ingenium-core";
import { jobsRouter } from "../lib/routes/jobs.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory: string;
let server: Server;
let baseUrl: string;
const projectName = "zen-job-suggestion";

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-jobs-suggest-broker-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  projects.createProject(projectName);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/jobs", jobsRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(() => vi.clearAllMocks());

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("POST /jobs/suggest Zen fallback", () => {
  it("uses a server-resolved Zen-only broker and ignores provider/model request fields", async () => {
    mocks.resolveSynthesisProviderSelections.mockResolvedValue({
      selections: [{ providerID: "opencode", modelID: "opencode/zen-free" }],
      catalogUnavailable: false,
    });
    mocks.executeSynthesisBroker.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        prompt_template: "Review the deployment report and summarize actionable failures.",
        schedule_cron: "0 9 * * 1-5",
        trigger_event: null,
      }),
    });

    const response = await fetch(`${baseUrl}/api/v1/jobs/suggest?project=${projectName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Review the deployment report every weekday morning",
        providerID: "attacker-provider",
        modelID: "attacker-model",
      }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      prompt_template: "Review the deployment report and summarize actionable failures.",
      schedule_cron: "0 9 * * 1-5",
      trigger_event: null,
      configured: true,
    });
    expect(mocks.executeSynthesisBroker).toHaveBeenCalledWith(expect.objectContaining({
      projectId: projects.getProject(projectName)!.id,
      timeoutMs: 30_000,
    }));
    expect(mocks.executeSynthesisBroker.mock.calls[0]![0]).not.toHaveProperty("selection");
  });
});
