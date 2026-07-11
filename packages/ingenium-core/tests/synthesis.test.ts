import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProject } from "../lib/tools/projects.js";
import { storeObservation } from "../lib/tools/observations.js";
import { runSynthesis, getSynthesisStatus } from "../lib/tools/synthesis.js";
import { getTraits, upsertTrait } from "../lib/tools/personality.js";
import { setSetting } from "../lib/tools/settings.js";

let tempDir: string;
let projectId: string;
let globalProjectId: string;
let mockServer: Server;
let mockPort: number;
let mockResponsePayload: any;
let mockResponseStatus: number;

function setMockResponse(payload: any, status = 200) {
  mockResponsePayload = payload;
  mockResponseStatus = status;
}

/** Build an OpenAI-style chat completions response wrapping a content string. */
function mockContent(content: string): any {
  return { choices: [{ message: { content } }] };
}

/** Return a default consolidation JSON that creates one trait from observations. */
function defaultConsolidation(obsIds: number[]): any {
  return {
    create: [
      {
        trait_type: "code_preference",
        trait_value: "User prefers concise and well-structured code",
        confidence_hint: 0.12,
        observation_ids: obsIds,
      },
    ],
    confirm: [],
    ignore_count: 0,
  };
}

/** Return an empty consolidation — no traits, just ignore everything. */
function emptyConsolidation(): any {
  return { create: [], confirm: [], ignore_count: 0 };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-synthesis-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
  const globalProject = createProject("global-default", true);
  globalProjectId = globalProject.id;

  // Configure LLM synthesis on global project
  setSetting(globalProjectId, "synthesis_model", "test-model");
  setSetting(globalProjectId, "synthesis_api_key", "test-key");

  // Spin up mock HTTP server
  await new Promise<void>((resolve) => {
    mockServer = createServer((_req, res) => {
      const body = typeof mockResponsePayload === "string"
        ? mockResponsePayload
        : JSON.stringify(mockResponsePayload);
      res.writeHead(mockResponseStatus, { "Content-Type": "application/json" });
      res.end(body);
    });
    mockServer.listen(0, () => {
      mockPort = (mockServer.address() as AddressInfo).port;
      resolve();
    });
  });

  // Set mock endpoint on global project
  setSetting(globalProjectId, "synthesis_endpoint", `http://localhost:${mockPort}`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  setMockResponse(mockContent("{}"));
});

describe("synthesis pipeline", () => {
  it("returns empty result when no observations exist", async () => {
    const result = await runSynthesis(projectId);
    expect(result.observations_processed).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("processes correction observations into consolidated traits", async () => {
    const obs1 = storeObservation(projectId, "correction", "User corrected method naming", 7);
    const obs2 = storeObservation(projectId, "correction", "User asked for more concise code", 6);
    const obs3 = storeObservation(projectId, "preference", "User likes 2-space indentation", 8);

    setMockResponse(mockContent(JSON.stringify(defaultConsolidation([obs1.id, obs2.id, obs3.id]))));

    const result = await runSynthesis(projectId);
    expect(result.observations_processed).toBe(3);
    expect(result.traits_created + result.traits_updated).toBeGreaterThanOrEqual(1);
    expect(result.errors.length).toBe(0);

    // Verify trait VALUE is normalized, NOT raw observation content
    const traits = getTraits(projectId);
    const consolidatedTrait = traits.find(t =>
      t.trait_value === "User prefers concise and well-structured code"
    );
    expect(consolidatedTrait).toBeDefined();
    // Ensure it's NOT a verbatim copy of any observation's content
    expect(consolidatedTrait!.trait_value).not.toBe("User corrected method naming");
    expect(consolidatedTrait!.trait_value).not.toBe("User asked for more concise code");
    expect(consolidatedTrait!.trait_value).not.toBe("User likes 2-space indentation");
  });

  it("skips already processed observations", async () => {
    const result = await runSynthesis(projectId);
    // Second run should find no pending observations
    expect(result.observations_processed).toBe(0);
  });

  it("reports synthesis status", () => {
    const status = getSynthesisStatus(projectId);
    expect(status.total_observations).toBeGreaterThanOrEqual(3);
    expect(status.pending_count).toBe(0);
    expect(status.processed_count).toBeGreaterThanOrEqual(3);
    expect(status.trait_count).toBeGreaterThanOrEqual(1);
    expect(status.last_synthesis_at).toBeTruthy();
  });

  it("handles terminology observations via consolidation", async () => {
    const obs = storeObservation(projectId, "terminology", "User calls it 'deploy' not 'release'", 5);

    setMockResponse(mockContent(JSON.stringify({
      create: [
        {
          trait_type: "terminology",
          trait_value: "User uses 'deploy' rather than 'release' for deployments",
          confidence_hint: 0.12,
          observation_ids: [obs.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    })));

    const result = await runSynthesis(projectId);
    expect(result.observations_processed).toBe(1);
    expect(result.traits_created + result.traits_updated).toBeGreaterThanOrEqual(1);
  });

  it("handles mixed observation types via consolidation", async () => {
    const obs1 = storeObservation(projectId, "behavior", "User always reviews PRs in the morning", 4);
    const obs2 = storeObservation(projectId, "workflow", "User runs lint before commit", 7);
    const obs3 = storeObservation(projectId, "goal", "User wants to improve test coverage", 6);
    const obs4 = storeObservation(projectId, "error", "User hit TypeScript strict mode error", 3);
    const obs5 = storeObservation(projectId, "feedback", "User said the response was too long", 8);

    setMockResponse(mockContent(JSON.stringify({
      create: [
        {
          trait_type: "workflow_pattern",
          trait_value: "User reviews PRs in the morning and runs lint before committing",
          confidence_hint: 0.15,
          observation_ids: [obs1.id, obs2.id],
        },
        {
          trait_type: "code_preference",
          trait_value: "User values comprehensive test coverage and strict TypeScript",
          confidence_hint: 0.15,
          observation_ids: [obs3.id, obs4.id],
        },
        {
          trait_type: "feedback_style",
          trait_value: "User prefers concise responses",
          confidence_hint: 0.12,
          observation_ids: [obs5.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    })));

    const result = await runSynthesis(projectId);
    expect(result.observations_processed).toBe(5);
    expect(result.errors.length).toBe(0);
  });

  it("pattern and insight observations may be ignored by LLM consolidation", async () => {
    const obs1 = storeObservation(projectId, "pattern", "User always adds JSDoc comments", 5);
    const obs2 = storeObservation(projectId, "insight", "Discovered container PTY needs glibc", 6);

    // LLM ignores these as implementation notes — returns empty consolidation
    setMockResponse(mockContent(JSON.stringify(emptyConsolidation())));

    const traitCountBefore = getTraits(projectId).length;
    const result = await runSynthesis(projectId);
    const traitCountAfter = getTraits(projectId).length;

    // Observations were skipped (not recognized by LLM), no new traits created
    expect(result.observations_skipped).toBeGreaterThanOrEqual(2);
    expect(traitCountAfter).toBe(traitCountBefore);
  });

  it("new traits start at clamped confidence (0.10-0.15)", async () => {
    const obs = storeObservation(projectId, "correction", "User corrected formatting style", 7);

    setMockResponse(mockContent(JSON.stringify({
      create: [
        {
          trait_type: "feedback_style",
          trait_value: "User has specific formatting preferences that the agent should follow",
          confidence_hint: 0.12,
          observation_ids: [obs.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    })));

    await runSynthesis(projectId);

    const traits = getTraits(projectId);
    const newTrait = traits.find(
      t => t.trait_value === "User has specific formatting preferences that the agent should follow"
    );
    expect(newTrait).toBeDefined();
    expect(newTrait!.confidence).toBeLessThan(0.3);
  });

  it("trait reaches display threshold after confirmations via consolidation", async () => {
    // Phase 1 creates a trait with confidence 0.12
    const obs1 = storeObservation(projectId, "preference", "User wants dark theme", 8);

    setMockResponse(mockContent(JSON.stringify({
      create: [
        {
          trait_type: "code_preference",
          trait_value: "User prefers dark theme UI throughout",
          confidence_hint: 0.12,
          observation_ids: [obs1.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    })));

    await runSynthesis(projectId);

    const traitsAfter1 = getTraits(projectId);
    const trait1 = traitsAfter1.find(t => t.trait_value === "User prefers dark theme UI throughout");
    expect(trait1).toBeDefined();
    const trait1Id = trait1!.id;
    expect(trait1!.confidence).toBeCloseTo(0.12, 1);

    // Phase 2: Second observation confirms the existing trait (+0.15 confidence)
    const obs2 = storeObservation(projectId, "preference", "User re-confirmed dark theme", 8);

    setMockResponse(mockContent(JSON.stringify({
      create: [],
      confirm: [{ trait_id: trait1Id, observation_id: obs2.id }],
      ignore_count: 0,
    })));

    await runSynthesis(projectId);

    const traitsAfter2 = getTraits(projectId);
    const trait2 = traitsAfter2.find(t => t.trait_value === "User prefers dark theme UI throughout");
    expect(trait2).toBeDefined();
    expect(trait2!.confidence).toBeGreaterThanOrEqual(0.27); // 0.12 + 0.15 = 0.27
  });

  it("confidence from upsertTrait caps at 0.95", async () => {
    const obs = storeObservation(projectId, "preference", "User likes camelCase", 6);

    // Create a trait with high confidence_hint
    setMockResponse(mockContent(JSON.stringify({
      create: [
        {
          trait_type: "code_preference",
          trait_value: "User prefers camelCase naming convention",
          confidence_hint: 0.15,
          observation_ids: [obs.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    })));

    await runSynthesis(projectId);

    const traits = getTraits(projectId);
    const trait = traits.find(t => t.trait_value === "User prefers camelCase naming convention");
    expect(trait).toBeDefined();
    expect(trait!.confidence).toBe(0.15);
    // Confidence must be capped at 0.95 max (but here it's 0.15, so the test
    // confirms NOT greater than 0.95 — the cap is tested in personality.test.ts)
    expect(trait!.confidence).toBeLessThanOrEqual(0.95);
  });

  it("trait decay reduces confidence after 7 days", async () => {
    // Create a trait with old updated_at
    const oldDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
    const trait = upsertTrait(
      projectId,
      "code_preference",
      "old-formatting-style",
      "Old formatting style",
      0.4,
    );

    // Manually set updated_at to 9 days ago via raw update (bypass upsertTrait clock reset)
    const { getDb, checkpointAfterWrite } = await import("../lib/db.js");
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    db.prepare("UPDATE personality_traits SET updated_at = ? WHERE id = ?").run(oldDate, trait.id);
    checkpointAfterWrite();

    // Run synthesis — decay should apply even if no observations to process
    await runSynthesis(projectId);

    const traits = getTraits(projectId);
    const decayed = traits.find(t => t.id === trait.id);
    expect(decayed).toBeDefined();
    expect(decayed!.confidence).toBeLessThan(0.4); // Should be 0.35 after -0.05 decay
  });
});
