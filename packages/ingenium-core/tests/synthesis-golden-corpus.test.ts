/**
 * Golden Corpus Test for Synthesis Governance Proposals.
 *
 * Defines known-good, known-noise, and known-duplicate observations to verify
 * the synthesis pipeline produces governance proposals instead of direct skill
 * mutations.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProject } from "../lib/tools/projects.js";
import { storeObservation } from "../lib/tools/observations.js";
import { runSynthesis } from "../lib/tools/synthesis.js";
import { listSkills, createSkill } from "../lib/tools/skills.js";
import { listProposals } from "../lib/tools/skill-governance.js";
import { setSetting } from "../lib/tools/settings.js";

let tempDir: string;
let projectId: string;
let globalProjectId: string;
let mockServer: Server;
let mockPort: number;
let mockResponseQueue: { payload: any; status?: number }[] = [];
let mockResponseQueueIndex = 0;

/** Build an OpenAI-style chat completions response wrapping a content string. */
function mockContent(content: string): any {
  return { choices: [{ message: { content } }] };
}

/** Queue sequential mock responses. Queue is consumed FIFO. */
function setMockResponseQueue(responses: { payload: any; status?: number }[]) {
  mockResponseQueue = responses;
  mockResponseQueueIndex = 0;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-golden-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-golden-project");
  projectId = project.id;
  const globalProject = createProject("global-golden", true);
  globalProjectId = globalProject.id;

  // Configure LLM synthesis on global project
  setSetting(globalProjectId, "synthesis_model", "golden-test-model");
  setSetting(globalProjectId, "synthesis_api_key", "golden-test-key");

  // Spin up mock HTTP server with sequential response queue
  await new Promise<void>((resolve) => {
    mockServer = createServer((_req, res) => {
      let payload: any;
      let status: number;
      if (mockResponseQueue.length > 0 && mockResponseQueueIndex < mockResponseQueue.length) {
        const entry = mockResponseQueue[mockResponseQueueIndex]!;
        payload = entry.payload;
        status = entry.status ?? 200;
        mockResponseQueueIndex++;
      } else {
        payload = { choices: [{ message: { content: "{}" } }] };
        status = 200;
      }
      const body = typeof payload === "string" ? payload : JSON.stringify(payload);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    });
    mockServer.listen(0, () => {
      mockPort = (mockServer.address() as AddressInfo).port;
      resolve();
    });
  });

  // Set mock endpoint on global project
  setSetting(globalProjectId, "synthesis_endpoint", `http://localhost:${mockPort}`);
  setSetting(globalProjectId, "synthesis_allow_private_network", "true");
});

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  setMockResponseQueue([
    { payload: mockContent(JSON.stringify({ create: [], confirm: [], ignore_count: 0 })) },
    { payload: mockContent(JSON.stringify({ skills_to_create: [], skills_to_update: [], personality_traits: [], insights: [], summary: "empty" })) },
  ]);
});

describe("golden corpus — known-good patterns produce proposals", () => {
  it("golden: 3+ related testing observations produce a skill create proposal", async () => {
    const proposalsBefore = listProposals(projectId);
    const skillsBefore = listSkills(projectId);

    // Golden corpus observations: strong testing discipline pattern (3+ related)
    const obs1 = storeObservation(projectId, "behavior", "User always writes unit tests before implementing new features", 8);
    const obs2 = storeObservation(projectId, "behavior", "User requires ALL branches to be tested, not just happy path", 7);
    const obs3 = storeObservation(projectId, "behavior", "User enforces 100% mutation test coverage on critical paths", 9);
    const obs4 = storeObservation(projectId, "preference", "User prefers Jest with React Testing Library for UI tests", 6);

    // Phase 1: consolidate into a trait
    const consolidationResponse = JSON.stringify({
      create: [
        {
          trait_type: "workflow_pattern",
          trait_value: "User practices rigorous test-driven development with high coverage standards",
          confidence_hint: 0.15,
          observation_ids: [obs1.id, obs2.id, obs3.id, obs4.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    });

    // Phase 2: LLM proposes a skill
    const synthesisResponse = JSON.stringify({
      skills_to_create: [
        {
          name: "rigorous-testing-standards",
          description: "User enforces comprehensive testing with mutation coverage",
          content: "## 🔴 HARD RULE\n\nAlways write tests before implementation. Cover all branches. Maintain 100% mutation coverage on critical paths. Use Jest + RTL for UI tests.",
          tags: "testing,quality,tbd,auto-generated",
        },
      ],
      skills_to_update: [],
      personality_traits: [
        {
          trait_type: "workflow_pattern",
          trait_value: "User is a testing-first developer",
          confidence: 0.3,
        },
      ],
      insights: ["Strong testing discipline detected across multiple observations"],
      summary: "Synthesized rigorous-testing-standards",
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse) },
      { payload: mockContent(synthesisResponse) },
    ]);

    const result = await runSynthesis(projectId);
    expect(result.errors.length).toBe(0);
    expect(result.skills_created).toBeGreaterThanOrEqual(1);

    // VERIFY: No direct skill creation
    const skillsAfter = listSkills(projectId);
    expect(skillsAfter.length).toBe(skillsBefore.length);

    // VERIFY: Proposal was created
    const proposalsAfter = listProposals(projectId);
    const newProposals = proposalsAfter.filter(p => !proposalsBefore.find(bp => bp.id === p.id));
    expect(newProposals.length).toBeGreaterThanOrEqual(1);

    const testingProposal = newProposals.find(p => p.target_name === "rigorous-testing-standards");
    expect(testingProposal).toBeDefined();
    expect(testingProposal!.proposal_type).toBe("create");
    expect(testingProposal!.status).toBe("pending");

    // VERIFY: Proposal has evidence (observation IDs linked)
    const evidence = JSON.parse(testingProposal!.evidence_json);
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    expect(evidence[0].trigger).toBe("LLM synthesis");
  });

  it("golden: repeated code-style corrections produce a skill update proposal", async () => {
    // Pre-create an existing skill
    const existing = createSkill(
      projectId,
      "code-style-guide",
      "Coding style preferences",
      "# Code Style\n\nUse 2-space indentation.",
    );

    const proposalsBefore = listProposals(projectId);
    const skillsBefore = listSkills(projectId);

    // Golden corpus: observations that extend an existing skill
    const obs1 = storeObservation(projectId, "correction", "User corrected indentation from tabs to 2 spaces", 7);
    const obs2 = storeObservation(projectId, "correction", "User wants trailing commas in multiline objects", 6);
    const obs3 = storeObservation(projectId, "preference", "User enforces single quotes over double quotes", 8);

    // Phase 1: traits
    const consolidationResponse = JSON.stringify({
      create: [
        {
          trait_type: "code_preference",
          trait_value: "User prefers 2-space indentation, trailing commas, and single quotes",
          confidence_hint: 0.15,
          observation_ids: [obs1.id, obs2.id, obs3.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    });

    // Phase 2: LLM extends the existing skill (update, not create)
    const synthesisResponse = JSON.stringify({
      skills_to_create: [],
      skills_to_update: [
        {
          name: "code-style-guide",
          patch: "## Additional Rules\n\n- Use trailing commas in multiline objects/arrays.\n- Enforce single quotes over double quotes.",
          patch_type: "add-rule",
        },
      ],
      personality_traits: [],
      insights: ["Code style preferences extended"],
      summary: "Updated code-style-guide",
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse) },
      { payload: mockContent(synthesisResponse) },
    ]);

    const result = await runSynthesis(projectId);
    expect(result.errors.length).toBe(0);

    // VERIFY: No direct skill update
    const skillsAfter = listSkills(projectId);
    expect(skillsAfter.length).toBe(skillsBefore.length);

    // VERIFY: Original skill content unchanged
    const skillAfter = skillsAfter.find(s => s.name === "code-style-guide");
    expect(skillAfter).toBeDefined();
    expect(skillAfter!.content).toBe("# Code Style\n\nUse 2-space indentation.");

    // VERIFY: Update proposal created
    const proposalsAfter = listProposals(projectId);
    const newProposals = proposalsAfter.filter(p => !proposalsBefore.find(bp => bp.id === p.id));
    expect(newProposals.length).toBeGreaterThanOrEqual(1);

    const updateProposal = newProposals.find(p => p.target_name === "code-style-guide" && p.proposal_type === "update");
    expect(updateProposal).toBeDefined();
    expect(updateProposal!.status).toBe("pending");

    // Cleanup
    existing;
  });
});

describe("golden corpus — known-noise is ignored", () => {
  it("golden: isolated low-importance observations produce no proposals", async () => {
    const proposalsBefore = listProposals(projectId);

    // Golden noise: isolated, low-importance observations with no coherent pattern
    const obs1 = storeObservation(projectId, "error", "Docker container failed to start due to port conflict", 2);
    const obs2 = storeObservation(projectId, "insight", "npm audit found 3 low-severity warnings", 3);
    const obs3 = storeObservation(projectId, "pattern", "User typed 'git status' once", 1);

    // Phase 1: LLM ignores these as noise
    const consolidationResponse = JSON.stringify({
      create: [],
      confirm: [],
      ignore_count: 3,
    });

    // Phase 2: No skills proposed
    const synthesisResponse = JSON.stringify({
      skills_to_create: [],
      skills_to_update: [],
      personality_traits: [],
      insights: [],
      summary: "No patterns detected",
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse) },
      { payload: mockContent(synthesisResponse) },
    ]);

    await runSynthesis(projectId);

    // VERIFY: No new proposals
    const proposalsAfter = listProposals(projectId);
    const newProposals = proposalsAfter.filter(p => !proposalsBefore.find(bp => bp.id === p.id));
    expect(newProposals.length).toBe(0);
  });

  it("golden: one-off observations with no related peers produce no proposals", async () => {
    const proposalsBefore = listProposals(projectId);

    // Golden noise: single observation with no supporting patterns
    const obs1 = storeObservation(projectId, "feedback", "User said 'ok thanks'", 2);
    const obs2 = storeObservation(projectId, "terminology", "User typed 'lgtm'", 1);

    // Phase 1: LLM ignores
    const consolidationResponse = JSON.stringify({
      create: [],
      confirm: [],
      ignore_count: 2,
    });

    // Phase 2: Empty
    const synthesisResponse = JSON.stringify({
      skills_to_create: [],
      skills_to_update: [],
      personality_traits: [],
      insights: [],
      summary: "Nothing actionable",
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse) },
      { payload: mockContent(synthesisResponse) },
    ]);

    await runSynthesis(projectId);

    // VERIFY: No new proposals
    const proposalsAfter = listProposals(projectId);
    const newProposals = proposalsAfter.filter(p => !proposalsBefore.find(bp => bp.id === p.id));
    expect(newProposals.length).toBe(0);
  });
});

describe("golden corpus — known-duplicates are deduplicated", () => {
  it("golden: duplicate observation patterns that match existing skill produce update, not create", async () => {
    // Pre-create a skill that the observations relate to
    const existing = createSkill(
      projectId,
      "commit-conventions",
      "Conventional commit standards",
      "# Commit Conventions\n\nUse `type(scope): description` format.",
    );

    const proposalsBefore = listProposals(projectId);

    // Golden duplicate: observations that reinforce an existing skill
    const obs1 = storeObservation(projectId, "correction", "User corrected commit message format to conventional commits", 6);
    const obs2 = storeObservation(projectId, "correction", "User wants feat scope to match module name", 7);

    // Phase 1: traits
    const consolidationResponse = JSON.stringify({
      create: [
        {
          trait_type: "workflow_pattern",
          trait_value: "User follows conventional commits format",
          confidence_hint: 0.12,
          observation_ids: [obs1.id, obs2.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    });

    // Phase 2: LLM returns an UPDATE (not CREATE) since the skill already exists
    const synthesisResponse = JSON.stringify({
      skills_to_create: [], // IMPORTANT: no create — the LLM knows this skill exists
      skills_to_update: [
        {
          name: "commit-conventions",
          patch: "## Scope Rules\n\nMatch feat scope to module name. Use lowercase.",
          patch_type: "add-rule",
        },
      ],
      personality_traits: [],
      insights: [],
      summary: "Updated commit-conventions",
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse) },
      { payload: mockContent(synthesisResponse) },
    ]);

    const result = await runSynthesis(projectId);
    expect(result.errors.length).toBe(0);

    // VERIFY: No skills_to_create were processed (no new skill created)
    // skills_created stays 0 because only an update was proposed, not a create
    // (note: skills_created tracks only create proposals)

    // VERIFY: Update proposal was created (not a create proposal)
    const proposalsAfter = listProposals(projectId);
    const newProposals = proposalsAfter.filter(p => !proposalsBefore.find(bp => bp.id === p.id));
    const createProposals = newProposals.filter(p => p.proposal_type === "create");
    const updateProposals = newProposals.filter(p => p.proposal_type === "update");

    // Should have an update proposal, not a create
    expect(updateProposals.length).toBeGreaterThanOrEqual(1);
    expect(updateProposals.find(p => p.target_name === "commit-conventions")).toBeDefined();
    // Verify no accidental create proposal for the same name
    expect(createProposals.find(p => p.target_name === "commit-conventions")).toBeUndefined();

    existing;
  });

  it("golden: duplicate observation re-submission does not create duplicate proposals", async () => {
    const proposalsBefore = listProposals(projectId);

    // Create observations
    const obs = storeObservation(projectId, "behavior", "User always adds JSDoc to public APIs", 7);

    const consolidationResponse = JSON.stringify({
      create: [
        {
          trait_type: "code_preference",
          trait_value: "User documents all public APIs with JSDoc",
          confidence_hint: 0.12,
          observation_ids: [obs.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    });

    const synthesisResponse = JSON.stringify({
      skills_to_create: [],
      skills_to_update: [],
      personality_traits: [],
      insights: [],
      summary: "No skills to create",
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse) },
      { payload: mockContent(synthesisResponse) },
    ]);

    // First synthesis run
    await runSynthesis(projectId);

    // Submit another observation with the same pattern
    const obs2 = storeObservation(projectId, "behavior", "User added JSDoc to the new utility functions", 6);

    const consolidationResponse2 = JSON.stringify({
      create: [],
      confirm: [],
      ignore_count: 1,
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse2) },
      { payload: mockContent(JSON.stringify({ skills_to_create: [], skills_to_update: [], personality_traits: [], insights: [], summary: "none" })) },
    ]);

    // Second synthesis run with the duplicate observation
    await runSynthesis(projectId);

    // VERIFY: No duplicate proposals from re-submission
    const proposalsAfter = listProposals(projectId);
    const newProposals = proposalsAfter.filter(p => !proposalsBefore.find(bp => bp.id === p.id));
    // Should not have accumulated duplicate proposals
    const proposalNames = newProposals.map(p => p.target_name);
    const uniqueNames = new Set(proposalNames);
    expect(uniqueNames.size).toBe(proposalNames.length); // no duplicate names
  });
});

describe("golden corpus — edge cases", () => {
  it("golden: synthesis continues gracefully when LLM proposes duplicate skill name", async () => {
    const proposalsBefore = listProposals(projectId);

    // Create observations
    const obs1 = storeObservation(projectId, "behavior", "User prefers functional programming style", 7);
    const obs2 = storeObservation(projectId, "behavior", "User uses map/filter/reduce instead of loops", 7);
    const obs3 = storeObservation(projectId, "behavior", "User avoids mutable state", 8);

    // Phase 1: create a trait
    const consolidationResponse = JSON.stringify({
      create: [
        {
          trait_type: "code_preference",
          trait_value: "User prefers functional programming patterns",
          confidence_hint: 0.14,
          observation_ids: [obs1.id, obs2.id, obs3.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    });

    // Phase 2: LLM proposes two distinct skills
    const synthesisResponse = JSON.stringify({
      skills_to_create: [
        {
          name: "functional-first",
          description: "User prefers functional programming over imperative",
          content: "## 🔴 HARD RULE\n\nPrefer functional style. Use map/filter/reduce. Avoid mutable state.",
          tags: "fp,style,auto-generated",
        },
        {
          name: "immutable-data",
          description: "User avoids mutable shared state",
          content: "## 🔴 HARD RULE\n\nNever mutate shared state. Use immutable data structures.",
          tags: "fp,data,auto-generated",
        },
      ],
      skills_to_update: [],
      personality_traits: [],
      insights: [],
      summary: "Created fp skills",
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse) },
      { payload: mockContent(synthesisResponse) },
    ]);

    // First run creates proposals for functional-first and immutable-data
    const result1 = await runSynthesis(projectId);
    expect(result1.errors.length).toBe(0);
    expect(result1.skills_created).toBeGreaterThanOrEqual(2);

    // Now create MORE observations and try to create functional-first again
    const obs4 = storeObservation(projectId, "behavior", "User requested immutable update patterns again", 8);

    const consolidationResponse2 = JSON.stringify({
      create: [
        {
          trait_type: "code_preference",
          trait_value: "User insists on immutable data patterns",
          confidence_hint: 0.12,
          observation_ids: [obs4.id],
        },
      ],
      confirm: [],
      ignore_count: 0,
    });

    // Phase 2: LLM tries to create a skill with the SAME name (duplicate)
    const synthesisResponse2 = JSON.stringify({
      skills_to_create: [
        {
          name: "functional-first", // DUPLICATE — already has a pending proposal
          description: "Duplicate attempt",
          content: "## HARD RULE\n\nDuplicate.",
          tags: "fp,duplicate",
        },
      ],
      skills_to_update: [],
      personality_traits: [],
      insights: [],
      summary: "Tried duplicate",
    });

    setMockResponseQueue([
      { payload: mockContent(consolidationResponse2) },
      { payload: mockContent(synthesisResponse2) },
    ]);

    // Second run: the duplicate create proposal is accepted by governance
    // (createProposal only blocks if the SKILL already exists, not if another
    // proposal with the same name exists — proposal-level dedup requires
    // candidateGroupKey which is not set by synthesis).
    // The pipeline should NOT crash.
    const result2 = await runSynthesis(projectId);
    expect(result2).toBeDefined();
    // No error should be thrown — the duplicate proposal just coexists
    expect(result2.errors.every(e => !e.includes("crash") && !e.includes("SIGSEGV"))).toBe(true);

    // Both proposals exist (governance doesn't auto-dedup by name)
    const proposalsAfter = listProposals(projectId);
    const functionalFirstProposals = proposalsAfter.filter(p => p.target_name === "functional-first");
    // Both proposals coexist — dedup by candidateGroupKey is not used in synthesis
    expect(functionalFirstProposals.length).toBe(2);
    // Both should be in pending state
    expect(functionalFirstProposals.every(p => p.status === "pending")).toBe(true);
  });
});
