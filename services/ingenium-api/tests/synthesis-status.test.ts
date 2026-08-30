import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import { observations, projects, resetDbForTest, synthesis } from "ingenium-core";
import { synthesisRouter } from "../lib/routes/synthesis.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

let directory = "";
let server: Server | undefined;
let baseUrl = "";
let primaryProjectName = "";
let primaryProjectId = "";
let foreignProjectName = "";
let foreignProjectId = "";

function statusUrl(projectName: string): string {
  return `${baseUrl}/api/v1/synthesis/status?project=${encodeURIComponent(projectName)}`;
}

function executorFor(proposal: object) {
  return async ({ system }: { system: string }) => ({
    ok: true,
    content: JSON.stringify(system.includes("personality model consolidator")
      ? { create: [], confirm: [], ignore_count: 1 }
      : proposal),
  });
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-api-synthesis-status-"));
  mkdirSync(join(directory, ".ingenium"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, ".ingenium", "data.db");
  resetDbForTest();

  primaryProjectName = "synthesis-status-primary";
  primaryProjectId = projects.createProject(primaryProjectName).id;
  foreignProjectName = "synthesis-status-foreign";
  foreignProjectId = projects.createProject(foreignProjectName).id;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/synthesis", synthesisRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(async () => {
  if (server) await closeHttpServer(server);
  server = undefined;
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("GET /api/v1/synthesis/status", () => {
  it("returns a content-free incomplete batch summary scoped to the requested project", async () => {
    observations.storeObservation(primaryProjectId, "workflow", "private-batch-observation", 8);
    observations.storeObservation(foreignProjectId, "workflow", "foreign-batch-observation", 8);

    await synthesis.runSynthesis(primaryProjectId, undefined, {
      llmExecutor: executorFor({
        skills_to_create: [],
        skills_to_update: [{
          name: "missing-status-target",
          patch: "private-plan-patch",
          patch_type: "add-rule",
        }],
        insights: ["private-plan-insight"],
        summary: "private-plan-summary",
      }),
    });

    const primaryResponse = await fetch(statusUrl(primaryProjectName));
    expect(primaryResponse.status).toBe(200);
    const primary = await primaryResponse.json() as { data: Record<string, unknown> };
    const incomplete = primary.data.incompleteBatch as Record<string, unknown>;

    expect(Object.keys(primary.data).sort()).toEqual([
      "incompleteBatch",
      "last_synthesis_at",
      "pending_count",
      "processed_count",
      "total_observations",
      "trait_count",
    ]);
    expect(Object.keys(incomplete).sort()).toEqual([
      "createdAt",
      "errorCount",
      "hasStoredProposalPlan",
      "lastErrorCode",
      "leaseState",
      "observationCount",
      "stage",
      "updatedAt",
    ]);
    expect(incomplete).toMatchObject({
      stage: "traits_applied",
      observationCount: 1,
      hasStoredProposalPlan: true,
      errorCount: 1,
      lastErrorCode: "PROPOSAL_APPLY_FAILED",
      leaseState: "available",
    });
    expect(typeof incomplete.createdAt).toBe("string");
    expect(typeof incomplete.updatedAt).toBe("string");
    expect(incomplete).not.toHaveProperty("id");
    expect(incomplete).not.toHaveProperty("ownerToken");
    expect(incomplete).not.toHaveProperty("owner_token");
    expect(incomplete).not.toHaveProperty("proposalPlan");
    expect(incomplete).not.toHaveProperty("proposal_plan");
    expect(incomplete).not.toHaveProperty("observationIds");
    expect(incomplete).not.toHaveProperty("observation_ids");
    expect(incomplete).not.toHaveProperty("lastErrorMessage");
    expect(incomplete).not.toHaveProperty("last_error_message");
    const serializedPrimary = JSON.stringify(primary);
    expect(serializedPrimary).not.toContain("private-batch-observation");
    expect(serializedPrimary).not.toContain("private-plan-patch");
    expect(serializedPrimary).not.toContain("private-plan-insight");
    expect(serializedPrimary).not.toContain("private-plan-summary");

    const foreignResponse = await fetch(statusUrl(foreignProjectName));
    expect(foreignResponse.status).toBe(200);
    const foreign = await foreignResponse.json() as { data: Record<string, unknown> };
    expect(foreign.data).toMatchObject({
      pending_count: 1,
      processed_count: 0,
      incompleteBatch: null,
    });
    expect(JSON.stringify(foreign)).not.toContain("private-batch-observation");
  });

  it("reports an active batch lease as owned without ownership metadata", async () => {
    observations.storeObservation(primaryProjectId, "workflow", "active-batch-observation", 8);
    let releaseConsolidation!: () => void;
    let markConsolidationStarted!: () => void;
    const consolidationStarted = new Promise<void>((resolve) => { markConsolidationStarted = resolve; });
    const waitForRelease = new Promise<void>((resolve) => { releaseConsolidation = resolve; });
    const executor = async ({ system }: { system: string }) => {
      if (system.includes("personality model consolidator")) {
        markConsolidationStarted();
        await waitForRelease;
        return { ok: true, content: JSON.stringify({ create: [], confirm: [], ignore_count: 1 }) };
      }
      return {
        ok: true,
        content: JSON.stringify({
          skills_to_create: [],
          skills_to_update: [],
          insights: [],
          summary: "no proposals",
        }),
      };
    };
    const running = synthesis.runSynthesis(primaryProjectId, undefined, { llmExecutor: executor });

    await consolidationStarted;
    try {
      const response = await fetch(statusUrl(primaryProjectName));
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { incompleteBatch: Record<string, unknown> } };
      expect(body.data.incompleteBatch).toMatchObject({
        stage: "created",
        observationCount: 1,
        hasStoredProposalPlan: false,
        errorCount: 0,
        lastErrorCode: null,
        leaseState: "owned",
      });
      expect(body.data.incompleteBatch).not.toHaveProperty("ownerToken");
      expect(body.data.incompleteBatch).not.toHaveProperty("owner_token");
    } finally {
      releaseConsolidation();
      await running;
    }
  });
});
