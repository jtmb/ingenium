/**
 * Skills Governance — MCP tool handler tests.
 *
 * Verifies: exact HTTP method/path/body, URI encoding, error propagation
 * for the 14 new governance tools plus fixes to existing handlers.
 *
 * All tests mock the api client so no actual HTTP requests are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// ── Mock the api client before importing handlers ──────────
const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
};

vi.mock("../lib/client.js", () => ({
  api: mockApi,
}));

// Dynamic import so mock is in place before module eval
const skillTools = await import("../lib/tools/skills.js");

// ── Helpers ────────────────────────────────────────────────

function mockApiSuccess(data: unknown = { ok: true }) {
  return { ok: true, status: 200, data };
}

function mockApiError(status: number, message: string) {
  return { ok: false, status, data: { error: { message } } };
}

// ── Tests ──────────────────────────────────────────────────

describe("Skills Governance Tools", () => {
  const PROJECT = "test-project";
  const SKILL_NAME = "my skill";
  const ENCODED_NAME = encodeURIComponent(SKILL_NAME);
  const ENCODED_PROJECT = encodeURIComponent(PROJECT);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Archive ────────────────────────────────────────────

  describe("ingenium_skill_archive", () => {
    it("POSTs to correct path with encoded name and project", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ archived: true }));

      const result = await skillTools.skillArchive(PROJECT, SKILL_NAME);

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/${ENCODED_NAME}/archive`,
        {},
        { project: PROJECT },
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.archived).toBe(true);
    });

    it("handles names with special characters", async () => {
      const specialName = "foo/bar?baz";
      mockApi.post.mockResolvedValue(mockApiSuccess({ archived: true }));

      await skillTools.skillArchive(PROJECT, specialName);

      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/${encodeURIComponent(specialName)}/archive`,
        {},
        { project: PROJECT },
      );
    });

    it("propagates API errors", async () => {
      mockApi.post.mockResolvedValue(mockApiError(404, "Skill not found"));

      const result = await skillTools.skillArchive(PROJECT, "missing");

      const data = JSON.parse(result.content[0].text);
      expect(data.error.message).toBe("Skill not found");
    });
  });

  // ── Restore ────────────────────────────────────────────

  describe("ingenium_skill_restore", () => {
    it("POSTs to correct path with encoded name", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ restored: true }));

      const result = await skillTools.skillRestore(PROJECT, SKILL_NAME);

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/${ENCODED_NAME}/restore`,
        {},
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.restored).toBe(true);
    });
  });

  // ── List Archived ──────────────────────────────────────

  describe("ingenium_skill_list_archived", () => {
    it("GETs /skills/archived with project param", async () => {
      mockApi.get.mockResolvedValue(mockApiSuccess({ skills: [] }));

      const result = await skillTools.skillListArchived(PROJECT);

      expect(mockApi.get).toHaveBeenCalledTimes(1);
      expect(mockApi.get).toHaveBeenCalledWith("/skills/archived", { project: PROJECT });
      const data = JSON.parse(result.content[0].text);
      expect(data.skills).toEqual([]);
    });
  });

  // ── Versions ───────────────────────────────────────────

  describe("ingenium_skill_versions", () => {
    it("GETs /skills/:name/versions with encoded name", async () => {
      mockApi.get.mockResolvedValue(mockApiSuccess({ versions: [{ id: 1 }] }));

      const result = await skillTools.skillVersions(PROJECT, SKILL_NAME);

      expect(mockApi.get).toHaveBeenCalledTimes(1);
      expect(mockApi.get).toHaveBeenCalledWith(
        `/skills/${ENCODED_NAME}/versions`,
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.versions).toHaveLength(1);
    });

    it("encodes names with slashes", async () => {
      const name = "category/sub-skill";
      mockApi.get.mockResolvedValue(mockApiSuccess({ versions: [] }));

      await skillTools.skillVersions(PROJECT, name);

      expect(mockApi.get).toHaveBeenCalledWith(
        `/skills/${encodeURIComponent(name)}/versions`,
        { project: PROJECT },
      );
    });
  });

  // ── Rollback ───────────────────────────────────────────

  describe("ingenium_skill_rollback", () => {
    it("POSTs to /skills/:name/rollback with revision in body", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ rolledBack: true, revision: 3 }));

      const result = await skillTools.skillRollback(PROJECT, SKILL_NAME, 3);

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/${ENCODED_NAME}/rollback`,
        { revision: 3 },
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.revision).toBe(3);
    });
  });

  // ── Lineage Create ─────────────────────────────────────

  describe("ingenium_skill_lineage_create", () => {
    it("POSTs to /skills/lineage with API-contract body fields", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ lineageId: 42 }));

      const result = await skillTools.skillLineageCreate(
        PROJECT, "project-uuid", "source-skill", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "abc123hash", ["a.ts", "b.ts"], undefined, "merged for dedup",
      );

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        "/skills/lineage",
        {
          sourceProjectId: "project-uuid",
          sourceName: "source-skill",
          targetSkillId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          sourceHash: "abc123hash",
          mergedFilePaths: ["a.ts", "b.ts"],
          reason: "merged for dedup",
        },
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.lineageId).toBe(42);
    });

    it("omits optional fields when not provided", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ lineageId: 1 }));

      await skillTools.skillLineageCreate(PROJECT, "proj", "src", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

      const body = mockApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("sourceHash");
      expect(body).not.toHaveProperty("mergedFilePaths");
      expect(body).not.toHaveProperty("tombstonePath");
      expect(body).not.toHaveProperty("reason");
    });
  });

  // ── Lineage List ───────────────────────────────────────

  describe("ingenium_skill_lineage_list", () => {
    it("GETs /skills/:name/lineage with encoded name", async () => {
      mockApi.get.mockResolvedValue(mockApiSuccess({ parents: [], children: [] }));

      const result = await skillTools.skillLineageList(PROJECT, SKILL_NAME);

      expect(mockApi.get).toHaveBeenCalledTimes(1);
      expect(mockApi.get).toHaveBeenCalledWith(
        `/skills/${ENCODED_NAME}/lineage`,
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.parents).toEqual([]);
      expect(data.children).toEqual([]);
    });
  });

  // ── Proposal Create ────────────────────────────────────

  const UUID_FIXTURE = "00000000-0000-0000-0000-000000000001";

  describe("ingenium_skill_proposal_create", () => {
    it("POSTs to /skills/proposals with full API-contract body", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ id: UUID_FIXTURE, status: "draft" }));

      const proposedState: skillTools.ProposalProposedState = {
        description: "Updated desc",
        content: "# New content",
      };
      const result = await skillTools.skillProposalCreate(
        PROJECT, "update", "target-skill", proposedState,
        "source-proj-id", "source-skill", 5,
        ["evidence 1"], [10, 20], 0.85, 0.60, false, "group-abc",
        1, UUID_FIXTURE,
      );

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      const callArgs = mockApi.post.mock.calls[0];
      expect(callArgs[0]).toBe("/skills/proposals");
      expect(callArgs[2]).toEqual({ project: PROJECT });

      const body = callArgs[1] as Record<string, unknown>;
      expect(body.proposalType).toBe("update");
      expect(body.targetName).toBe("target-skill");
      expect(body.sourceProjectId).toBe("source-proj-id");
      expect(body.sourceName).toBe("source-skill");
      expect(body.expectedRevision).toBe(5);
      expect(body.evidence).toEqual(["evidence 1"]);
      expect(body.observationIds).toEqual([10, 20]);
      expect(body.qualityScore).toBe(0.85);
      expect(body.noveltyScore).toBe(0.60);
      expect(body.contradictionFlag).toBe(false);
      expect(body.candidateGroupKey).toBe("group-abc");
      expect(body.alwaysApply).toBe(1);
      expect(body.targetSkillId).toBe(UUID_FIXTURE);
      // Verify old fields are NOT present
      expect(body).not.toHaveProperty("type");
      expect(body).not.toHaveProperty("target");
      expect(body).not.toHaveProperty("source");

      const ps = body.proposedState as Record<string, unknown>;
      expect(ps.description).toBe("Updated desc");
      expect(ps.content).toBe("# New content");
    });

    it("omits undefined optional fields from body", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ id: UUID_FIXTURE }));

      const proposedState: skillTools.ProposalProposedState = { content: "minimal" };
      await skillTools.skillProposalCreate(PROJECT, "archive", "old-skill", proposedState);

      const body = mockApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("sourceProjectId");
      expect(body).not.toHaveProperty("sourceName");
      expect(body).not.toHaveProperty("evidence");
      expect(body).not.toHaveProperty("qualityScore");
      expect(body).not.toHaveProperty("alwaysApply");
      expect(body).not.toHaveProperty("targetSkillId");
    });

    it("does not mutate caller's proposedState object", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ id: UUID_FIXTURE }));

      const proposedState: skillTools.ProposalProposedState = { content: "test" };
      const frozen = { ...proposedState };
      await skillTools.skillProposalCreate(PROJECT, "create", "new-skill", proposedState);

      // Caller's object should remain unchanged
      expect(proposedState).toEqual(frozen);
      expect(proposedState).not.toHaveProperty("alwaysApply");
    });
  });

  // ── Proposal List ──────────────────────────────────────

  describe("ingenium_skill_proposal_list", () => {
    it("GETs /skills/proposals with optional status filter", async () => {
      mockApi.get.mockResolvedValue(mockApiSuccess({ proposals: [] }));

      const result = await skillTools.skillProposalList(PROJECT, "pending");

      expect(mockApi.get).toHaveBeenCalledWith("/skills/proposals", { project: PROJECT, status: "pending" });
      const data = JSON.parse(result.content[0].text);
      expect(data.proposals).toEqual([]);
    });

    it("omits status param when not provided", async () => {
      mockApi.get.mockResolvedValue(mockApiSuccess({ proposals: [] }));

      await skillTools.skillProposalList(PROJECT);

      expect(mockApi.get).toHaveBeenCalledWith("/skills/proposals", { project: PROJECT });
    });
  });

  // ── Proposal Get ───────────────────────────────────────

  describe("ingenium_skill_proposal_get", () => {
    it("GETs /skills/proposals/:id with UUID", async () => {
      mockApi.get.mockResolvedValue(mockApiSuccess({ id: UUID_FIXTURE, status: "draft" }));

      const result = await skillTools.skillProposalGet(PROJECT, UUID_FIXTURE);

      expect(mockApi.get).toHaveBeenCalledTimes(1);
      expect(mockApi.get).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID_FIXTURE)}`,
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe(UUID_FIXTURE);
    });
  });

  // ── Proposal Submit ────────────────────────────────────

  describe("ingenium_skill_proposal_submit", () => {
    it("POSTs to /skills/proposals/:id/submit with UUID", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ status: "pending" }));

      const result = await skillTools.skillProposalSubmit(PROJECT, UUID_FIXTURE);

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID_FIXTURE)}/submit`,
        {},
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("pending");
    });
  });

  // ── Proposal Approve ───────────────────────────────────

  describe("ingenium_skill_proposal_approve", () => {
    it("POSTs reviewer (required) and reason (optional) in body with UUID", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ status: "applied" }));

      const result = await skillTools.skillProposalApprove(PROJECT, UUID_FIXTURE, "alice", "LGTM");

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID_FIXTURE)}/approve`,
        { reviewer: "alice", reason: "LGTM" },
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("applied");
    });

    it("omits reason when not provided", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ status: "applied" }));

      await skillTools.skillProposalApprove(PROJECT, UUID_FIXTURE, "bob");

      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID_FIXTURE)}/approve`,
        { reviewer: "bob", reason: undefined },
        { project: PROJECT },
      );
    });
  });

  // ── Proposal Reject ────────────────────────────────────

  describe("ingenium_skill_proposal_reject", () => {
    it("POSTs reviewer (required) and reason (optional) in body with UUID", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ status: "rejected" }));

      const result = await skillTools.skillProposalReject(PROJECT, UUID_FIXTURE, "carol", "Not needed");

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID_FIXTURE)}/reject`,
        { reviewer: "carol", reason: "Not needed" },
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("rejected");
    });
  });

  // ── Proposal Rollback ──────────────────────────────────

  describe("ingenium_skill_proposal_rollback", () => {
    it("POSTs reviewer (required) and reason (optional) in body with UUID", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ status: "rolledBack" }));

      const result = await skillTools.skillProposalRollback(PROJECT, UUID_FIXTURE, "dave", "Reverting");

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID_FIXTURE)}/rollback`,
        { reviewer: "dave", reason: "Reverting" },
        { project: PROJECT },
      );
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("rolledBack");
    });
  });

  // ── Existing tool fixes ────────────────────────────────

  describe("existing tool URI-encoding fixes", () => {
    it("skillDelete uses encodeURIComponent for name and params object for project", async () => {
      mockApi.del.mockResolvedValue({ ok: true, status: 204, data: null });

      await skillTools.skillDelete(PROJECT, "special/name");

      expect(mockApi.del).toHaveBeenCalledWith(
        `/skills/${encodeURIComponent("special/name")}`,
        { project: PROJECT },
      );
    });

    it("skillEnable uses encodeURIComponent for name and project", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ enabled: true }));

      await skillTools.skillEnable(PROJECT, "special/name");

      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/${encodeURIComponent("special/name")}/enable?project=${ENCODED_PROJECT}`,
      );
    });

    it("skillDisable uses encodeURIComponent for name and project", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({ disabled: true }));

      await skillTools.skillDisable(PROJECT, "special/name");

      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/${encodeURIComponent("special/name")}/disable?project=${ENCODED_PROJECT}`,
      );
    });
  });

  // ── Error propagation ──────────────────────────────────

  describe("error propagation", () => {
    it("passes through API error responses intact", async () => {
      mockApi.get.mockResolvedValue(mockApiError(500, "Internal error"));

      const result = await skillTools.skillVersions(PROJECT, "any");

      const data = JSON.parse(result.content[0].text);
      expect(data.error.message).toBe("Internal error");
    });

    it("handles 404 for proposal get", async () => {
      mockApi.get.mockResolvedValue(mockApiError(404, "Proposal not found"));

      const result = await skillTools.skillProposalGet(PROJECT, UUID_FIXTURE);

      const data = JSON.parse(result.content[0].text);
      expect(data.error.message).toBe("Proposal not found");
    });
  });

  // ── API↔MCP Route/Body/Schema Parity Regression Guard ──

  describe("API↔MCP contract parity", () => {
    const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    it("rollback body uses 'revision' not 'versionId'", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({}));
      await skillTools.skillRollback(PROJECT, "s", 0);
      const body = mockApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).toHaveProperty("revision");
      expect(body).not.toHaveProperty("versionId");
    });

    it("lineage create body uses API contract (sourceProjectId, sourceName, targetSkillId)", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({}));
      await skillTools.skillLineageCreate(PROJECT, "pid", "src", UUID);
      const body = mockApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).toHaveProperty("sourceProjectId", "pid");
      expect(body).toHaveProperty("sourceName", "src");
      expect(body).toHaveProperty("targetSkillId", UUID);
      expect(body).not.toHaveProperty("parentName");
      expect(body).not.toHaveProperty("childName");
      expect(body).not.toHaveProperty("relationshipType");
    });

    it("proposal create body uses 'proposalType' not 'type'", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({}));
      const ps: skillTools.ProposalProposedState = { content: "x" };
      await skillTools.skillProposalCreate(PROJECT, "create", "tgt", ps);
      const body = mockApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).toHaveProperty("proposalType", "create");
      expect(body).not.toHaveProperty("type");
      expect(body).not.toHaveProperty("target");
      expect(body).not.toHaveProperty("source");
    });

    it("proposal IDs are UUID strings (not numbers)", async () => {
      mockApi.get.mockResolvedValue(mockApiSuccess({}));
      mockApi.post.mockResolvedValue(mockApiSuccess({}));

      await skillTools.skillProposalGet(PROJECT, UUID);
      expect(mockApi.get).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID)}`,
        { project: PROJECT },
      );

      await skillTools.skillProposalSubmit(PROJECT, UUID);
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID)}/submit`,
        {},
        { project: PROJECT },
      );

      await skillTools.skillProposalApprove(PROJECT, UUID, "r");
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID)}/approve`,
        { reviewer: "r", reason: undefined },
        { project: PROJECT },
      );

      await skillTools.skillProposalReject(PROJECT, UUID, "r");
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID)}/reject`,
        { reviewer: "r", reason: undefined },
        { project: PROJECT },
      );

      await skillTools.skillProposalRollback(PROJECT, UUID, "r");
      expect(mockApi.post).toHaveBeenCalledWith(
        `/skills/proposals/${encodeURIComponent(UUID)}/rollback`,
        { reviewer: "r", reason: undefined },
        { project: PROJECT },
      );
    });

    it("proposal create does not mutate caller's proposedState", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({}));
      const ps: skillTools.ProposalProposedState = { content: "test" };
      const copy = { ...ps };
      await skillTools.skillProposalCreate(PROJECT, "create", "tgt", ps);
      expect(ps).toEqual(copy);
    });

    it("proposal body omits alwaysApply when not provided", async () => {
      mockApi.post.mockResolvedValue(mockApiSuccess({}));
      await skillTools.skillProposalCreate(PROJECT, "create", "tgt", { content: "x" });
      const body = mockApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("alwaysApply");
    });
  });

  // ── Static registration schema inspection (Gap 4 regression guard) ──
  // Reads the actual mcp-server.ts source to validate schema registrations directly.
  // Catches reversions to deprecated fields that wrapper tests alone can miss.

  describe("mcp-server.ts registration schema contract (source inspection)", () => {
    let mcpSource: string;

    beforeAll(async () => {
      const { readFileSync } = await import("node:fs");
      const filePath = new URL("../scripts/mcp-server.ts", import.meta.url).pathname;
      mcpSource = readFileSync(filePath, "utf-8");
    });

    it("does not use versionId in rollback registration — uses revision with int+min(0)", () => {
      const rollbackBlock = mcpSource.slice(
        mcpSource.indexOf('"ingenium_skill_rollback"'),
        mcpSource.indexOf('ingenium_skill_lineage_create'),
      );
      expect(rollbackBlock).not.toMatch(/versionId/);
      expect(rollbackBlock).toMatch(/revision:\s*z\.number\(\)\.int\(\)\.min\(0\)/);
    });

    it("does not use numeric proposal IDs", () => {
      const proposalSection = mcpSource.slice(
        mcpSource.indexOf('"ingenium_skill_proposal_create"'),
        mcpSource.indexOf('ingenium_observe'),
      );
      expect(proposalSection).not.toMatch(/proposalId:\s*z\.number\(\)/);
      expect(proposalSection).toMatch(/proposalId:\s*z\.string\(\)\.uuid\(\)/);
    });

    it("does not use parentName/childName/relationshipType in lineage create registration", () => {
      const lineageBlock = mcpSource.slice(
        mcpSource.indexOf('"ingenium_skill_lineage_create"'),
        mcpSource.indexOf('ingenium_skill_lineage_list'),
      );
      expect(lineageBlock).not.toMatch(/parentName/);
      expect(lineageBlock).not.toMatch(/childName/);
      expect(lineageBlock).not.toMatch(/relationshipType/);
      expect(lineageBlock).toMatch(/sourceProjectId/);
      expect(lineageBlock).toMatch(/sourceName/);
      expect(lineageBlock).toMatch(/targetSkillId/);
    });

    it("does not use unstructured z.record for proposedState", () => {
      const proposalBlock = mcpSource.slice(
        mcpSource.indexOf('"ingenium_skill_proposal_create"'),
        mcpSource.indexOf('ingenium_skill_proposal_list'),
      );
      expect(proposalBlock).not.toMatch(/proposedState:\s*z\.record/);
      expect(proposalBlock).toMatch(/proposedState:\s*z\.object/);
    });

    it("has evidence typed as unknown[] not string[]", () => {
      const proposalBlock = mcpSource.slice(
        mcpSource.indexOf('"ingenium_skill_proposal_create"'),
        mcpSource.indexOf('ingenium_skill_proposal_list'),
      );
      expect(proposalBlock).not.toMatch(/evidence:\s*z\.array\(z\.string\(\)\)/);
    });

    it("has status enum with rolled_back (DB status) not rolledBack (response)", () => {
      const listBlock = mcpSource.slice(
        mcpSource.indexOf('"ingenium_skill_proposal_list"'),
        mcpSource.indexOf('ingenium_skill_proposal_get'),
      );
      expect(listBlock).toMatch(/rolled_back/);
      expect(listBlock).not.toMatch(/rolledBack/);
    });
  });
});
