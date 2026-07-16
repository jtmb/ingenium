import { Router } from "express";
import { skills, skillGovernance, synthesis, getSkillsBase, maintenanceLocks } from "ingenium-core";
import type { Skill, SkillVersion, SkillLineage, SkillProposal } from "ingenium-core";
import { requireProject } from "../helpers.js";
import fs from "fs";
import path from "path";

/** Handles /api/v1/skills — CRUD, governance (archive/restore/versions/lineage/proposals), locks, and sync. */
export const skillsRouter = Router();

// ── Constants ────────────────────────────────────────────────────────────────
const LOCK_RESOURCE = "skills";
const LOCK_TTL_MIN_MS = 1_000;
const LOCK_TTL_MAX_MS = 300_000; // 5 minutes
const LOCK_TTL_DEFAULT_MS = 30_000; // 30 seconds

// ── DTO helpers ──────────────────────────────────────────────────────────────
//
// Skill rows (list / get / create / update / archive / restore / rollback / sync)
//   → raw DB row spread: preserves all columns including new revision/archived_at
//     and any FTS rank added by searchSkills. Dashboard and resource-sync depend
//     on the snake_case keys (always_apply, file_tree as JSON string, enabled as 0/1).
//
// Governance DTOs (version / lineage / proposal / lock)
//   → camelCase with parsed JSON fields. These are new Phase 2B types.

/**
 * Parse a JSON string field safely. Returns defaultValue on failure.
 */
function safeJsonParse<T>(raw: string | undefined | null, defaultValue: T): T {
  if (!raw) return defaultValue;
  try { return JSON.parse(raw) as T; } catch { return defaultValue; }
}

/** Return the raw DB row unchanged so every column (including FTS rank) is preserved.
 *  Dashboard + resource-sync depend on snake_case keys and file_tree as a JSON string. */
function skillToDto(s: Skill): Record<string, unknown> {
  return { ...(s as Record<string, unknown>) };
}

/** Convert a raw DB skill version row to a camelCase DTO. */
function versionToDto(v: SkillVersion): Record<string, unknown> {
  return {
    id: v.id,
    skillId: v.skill_id,
    revision: v.revision,
    name: v.name,
    description: v.description,
    content: v.content,
    category: v.category ?? null,
    tags: v.tags ?? null,
    alwaysApply: v.always_apply,
    fileTree: safeJsonParse((v as any).file_tree as string | undefined | null, null),
    enabled: !!v.enabled,
    archivedAt: (v as any).archived_at ?? null,
    createdBy: (v as any).created_by ?? "system",
    createdAt: (v as any).created_at,
  };
}

/** Convert a raw DB lineage row to a camelCase DTO. Parses mergedFilePaths from JSON string. */
function lineageToDto(l: SkillLineage): Record<string, unknown> {
  return {
    id: l.id,
    projectId: l.project_id,
    sourceProjectId: l.source_project_id,
    sourceName: l.source_name,
    targetSkillId: l.target_skill_id,
    sourceHash: l.source_hash,
    mergedFilePaths: safeJsonParse(l.merged_file_paths, [] as string[]),
    tombstonePath: l.tombstone_path ?? null,
    reason: l.reason,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}

/** Map DB proposal status (snake_case) to camelCase where applicable. */
function mapProposalStatus(status: string): string {
  switch (status) {
    case "rolled_back": return "rolledBack";
    default: return status;
  }
}

/** Map common snake_case keys in proposedState JSON to camelCase for response.
 *  Parses stored `file_tree` JSON string into a `fileTree` object. Invalid JSON is handled safely. */
function camelizeProposedState(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state };
  const keyMap: Record<string, string> = {
    always_apply: "alwaysApply",
    file_tree: "fileTree",
  };
  for (const [snake, camel] of Object.entries(keyMap)) {
    if (snake in out) {
      const val = out[snake];
      if (snake === "file_tree" && typeof val === "string") {
        out[camel] = safeJsonParse(val, null);
      } else {
        out[camel] = val;
      }
      delete out[snake];
    }
  }
  return out;
}

/** Convert a raw DB proposal row to a camelCase DTO. Parses all JSON storage fields. */
function proposalToDto(p: SkillProposal): Record<string, unknown> {
  return {
    id: p.id,
    projectId: p.project_id,
    status: mapProposalStatus(p.status),
    proposalType: p.proposal_type,
    targetSkillId: p.target_skill_id ?? null,
    targetName: p.target_name,
    sourceProjectId: p.source_project_id ?? null,
    sourceName: p.source_name ?? null,
    expectedRevision: p.expected_revision ?? null,
    expectedSourceRevision: p.expected_source_revision ?? null,
    targetRevisionBefore: p.target_revision_before ?? null,
    sourceRevisionBefore: p.source_revision_before ?? null,
    targetCreated: p.target_created,
    proposedState: camelizeProposedState(safeJsonParse(p.proposed_state, {} as Record<string, unknown>)),
    evidence: safeJsonParse(p.evidence_json, [] as unknown[]),
    observationIds: safeJsonParse(p.observation_ids, [] as unknown[]),
    qualityScore: p.quality_score,
    noveltyScore: p.novelty_score,
    contradictionFlag: p.contradiction_flag,
    candidateGroupKey: p.candidate_group_key ?? null,
    reviewer: p.reviewer ?? null,
    reviewReason: p.review_reason ?? null,
    alwaysApply: p.always_apply,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    reviewedAt: p.reviewed_at ?? null,
    appliedAt: p.applied_at ?? null,
    rolledBackAt: p.rolled_back_at ?? null,
  };
}

/** Map a skillGovernance.GovernanceError to an HTTP status code. Structured codes, no brittle message parsing. */
function governanceErrorStatus(err: skillGovernance.GovernanceError): number {
  switch (err.code) {
    case "LINEAGE_CYCLE":
    case "DUPLICATE_PROPOSAL":
    case "INVALID_STATUS_TRANSITION":
    case "TARGET_EXISTS":
      return 409;
    case "TARGET_NOT_FOUND":
    case "PROPOSAL_NOT_FOUND":
    case "SOURCE_NOT_FOUND":
      return 404;
    case "TARGET_OWNERSHIP":
    case "NOT_OWNER":
      return 403;
    case "INVALID_PROPOSED_STATE":
    case "INVALID_NAME":
    case "INVALID_SCORE":
    case "INVALID_REVISION":
    case "INVALID_FLAG":
    case "INVALID_KEY":
    case "MISSING_SOURCE":
    case "MISSING_TARGET":
    case "TARGET_ARCHIVED":
    case "SOURCE_ARCHIVED":
    case "NAME_MISMATCH":
    case "INVALID_JSON":
      return 400;
    default:
      return err.statusCode || 400;
  }
}

/** Map skillGovernance.GovernanceError to structured API error body. */
function governanceErrorPayload(err: skillGovernance.GovernanceError) {
  return { error: { code: err.code, message: err.message } };
}

// ── Read routes (no lock required) ──────────────────────────────────────────

skillsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const list = skills.listSkills(projectId);
  res.json({ data: list.map(skillToDto), total: list.length });
});

skillsRouter.get("/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const query = req.query.q as string;
  if (!query) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
    return;
  }
  const results = skills.searchSkills(projectId, query);
  res.json({ data: results.map(skillToDto), total: results.length });
});

// ── Governance read routes (static — before :name routes) ────────────────────

/** GET /archived — list archived (soft-deleted) skills for the project. */
skillsRouter.get("/archived", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const list = skills.listArchivedSkills(projectId);
  res.json({ data: list.map(skillToDto), total: list.length });
});

/** GET /proposals — list all governance proposals for the project (optional ?status filter). */
skillsRouter.get("/proposals", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const statusFilter = req.query.status as string | undefined;
  if (statusFilter && !["draft", "pending", "rejected", "applied", "rolled_back", "stale"].includes(statusFilter)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: `Invalid status filter: ${statusFilter}` } });
    return;
  }
  const list = skillGovernance.listProposals(projectId, statusFilter);
  res.json({ data: list.map(proposalToDto), total: list.length });
});

/** GET /proposals/:proposalId — get a single proposal by ID. */
skillsRouter.get("/proposals/:proposalId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const p = skillGovernance.getProposal(projectId, req.params.proposalId!);
    if (!p) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Proposal '${req.params.proposalId}' not found` } });
      return;
    }
    res.json({ data: proposalToDto(p) });
  } catch (err) {
    if (err instanceof skillGovernance.GovernanceError) {
      res.status(governanceErrorStatus(err)).json(governanceErrorPayload(err));
      return;
    }
    throw err;
  }
});

/** POST /proposals — create a new governance proposal (lock-gated). */
skillsRouter.post("/proposals", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const {
    proposalType, targetName, proposedState,
    sourceProjectId, sourceName, expectedRevision,
    evidence, observationIds, qualityScore, noveltyScore,
    contradictionFlag, candidateGroupKey, alwaysApply, targetSkillId,
  } = req.body || {};

  if (!proposalType || !["create", "update", "merge", "archive"].includes(proposalType)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "proposalType must be one of: create, update, merge, archive" } });
    return;
  }
  if (!targetName || typeof targetName !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "targetName is required (string, 1-64 chars)" } });
    return;
  }
  if (proposedState === undefined || proposedState === null || typeof proposedState !== "object") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "proposedState is required (JSON object)" } });
    return;
  }

  // Convert camelCase request → core's snake_case JSON shape.
  // Core expects file_tree as a JSON string; always_apply as a number.
  const coreProposedState: Record<string, unknown> = { ...proposedState };
  if ("alwaysApply" in coreProposedState) {
    coreProposedState.always_apply = coreProposedState.alwaysApply;
    delete coreProposedState.alwaysApply;
  }
  if ("fileTree" in coreProposedState) {
    // Core expects file_tree to be a JSON string, not a raw object
    const ft = coreProposedState.fileTree;
    coreProposedState.file_tree = (typeof ft === "string") ? ft : JSON.stringify(ft);
    delete coreProposedState.fileTree;
  }
  const proposedStateJson = JSON.stringify(coreProposedState);

  try {
    const proposal = skillGovernance.createProposal(
      projectId, proposalType, targetName, proposedStateJson,
      {
        sourceProjectId, sourceName, expectedRevision,
        evidenceJson: evidence ? JSON.stringify(evidence) : undefined,
        observationIds: observationIds ? JSON.stringify(observationIds) : undefined,
        qualityScore: qualityScore !== undefined ? Number(qualityScore) : undefined,
        noveltyScore: noveltyScore !== undefined ? Number(noveltyScore) : undefined,
        contradictionFlag: contradictionFlag !== undefined ? Number(contradictionFlag) : undefined,
        candidateGroupKey,
        alwaysApply: alwaysApply !== undefined ? Number(alwaysApply) : undefined,
        targetSkillId,
      },
    );
    res.status(201).json({ data: proposalToDto(proposal) });
  } catch (err) {
    if (err instanceof skillGovernance.GovernanceError) {
      res.status(governanceErrorStatus(err)).json(governanceErrorPayload(err));
      return;
    }
    throw err;
  }
});

/** POST /proposals/:proposalId/submit — submit a draft proposal for review (lock-gated). */
skillsRouter.post("/proposals/:proposalId/submit", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  try {
    const result = skillGovernance.submitProposal(projectId, req.params.proposalId!);
    if (!result) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: `Proposal '${req.params.proposalId}' not found` } });
      return;
    }
    res.json({ data: proposalToDto(result) });
  } catch (err) {
    if (err instanceof skillGovernance.GovernanceError) {
      res.status(governanceErrorStatus(err)).json(governanceErrorPayload(err));
      return;
    }
    throw err;
  }
});

/** POST /proposals/:proposalId/approve — approve a pending proposal and apply it (lock-gated). */
skillsRouter.post("/proposals/:proposalId/approve", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const { reviewer, reason } = req.body || {};
  if (!reviewer || typeof reviewer !== "string" || reviewer.trim().length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "reviewer is required (non-empty string)" } });
    return;
  }

  try {
    const result = skillGovernance.approveProposal(projectId, req.params.proposalId!, reviewer.trim(), reason);
    res.json({ data: proposalToDto(result) });
  } catch (err) {
    if (err instanceof skillGovernance.GovernanceError) {
      res.status(governanceErrorStatus(err)).json(governanceErrorPayload(err));
      return;
    }
    throw err;
  }
});

/** POST /proposals/:proposalId/reject — reject a pending proposal (lock-gated). */
skillsRouter.post("/proposals/:proposalId/reject", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const { reviewer, reason } = req.body || {};
  if (!reviewer || typeof reviewer !== "string" || reviewer.trim().length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "reviewer is required (non-empty string)" } });
    return;
  }

  try {
    const result = skillGovernance.rejectProposal(projectId, req.params.proposalId!, reviewer.trim(), reason);
    res.json({ data: proposalToDto(result) });
  } catch (err) {
    if (err instanceof skillGovernance.GovernanceError) {
      res.status(governanceErrorStatus(err)).json(governanceErrorPayload(err));
      return;
    }
    throw err;
  }
});

/** POST /proposals/:proposalId/rollback — roll back an applied proposal (lock-gated). */
skillsRouter.post("/proposals/:proposalId/rollback", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const { reviewer, reason } = req.body || {};
  if (!reviewer || typeof reviewer !== "string" || reviewer.trim().length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "reviewer is required (non-empty string)" } });
    return;
  }

  try {
    const result = skillGovernance.rollbackProposal(projectId, req.params.proposalId!, reviewer.trim(), reason);
    res.json({ data: proposalToDto(result) });
  } catch (err) {
    if (err instanceof skillGovernance.GovernanceError) {
      res.status(governanceErrorStatus(err)).json(governanceErrorPayload(err));
      return;
    }
    throw err;
  }
});

/** POST /lineage — create a lineage record linking a source skill to a target (lock-gated). */
skillsRouter.post("/lineage", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const { sourceProjectId, sourceName, targetSkillId, sourceHash, mergedFilePaths, tombstonePath, reason } = req.body || {};
  if (!sourceProjectId || typeof sourceProjectId !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "sourceProjectId is required" } });
    return;
  }
  if (!sourceName || typeof sourceName !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "sourceName is required" } });
    return;
  }
  if (!targetSkillId || typeof targetSkillId !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "targetSkillId is required" } });
    return;
  }

  try {
    const lineage = skillGovernance.createLineage(
      projectId, sourceProjectId, sourceName, targetSkillId,
      sourceHash, mergedFilePaths, tombstonePath, reason,
    );
    res.status(201).json({ data: lineageToDto(lineage) });
  } catch (err) {
    if (err instanceof skillGovernance.GovernanceError) {
      res.status(governanceErrorStatus(err)).json(governanceErrorPayload(err));
      return;
    }
    throw err;
  }
});

// ── Lock endpoints (MUST be before parameterized :name routes) ──────────────

/**
 * Sanitize a lock DB row to a camelCase DTO with no owner_token exposure.
 * Never leaks the owner_token — only acquire returns the generated token.
 */
function lockToDto(lock: { id: number; resource: string; project_id: string; acquired_at: string; expires_at: string; owner_token?: string }): Record<string, unknown> {
  const dto: Record<string, unknown> = {
    resource: lock.resource,
    projectId: lock.project_id,
    acquiredAt: lock.acquired_at,
    expiresAt: lock.expires_at,
  };
  if (lock.project_id === "*") {
    dto.scope = "global";
  }
  // 🔴 NEVER include ownerToken/owner_token in list/status responses
  return dto;
}

/**
 * POST /skills/locks/acquire — acquire a maintenance lock on the skills resource.
 *
 * Query: ?project=<name>  (resolved to UUID internally)
 * Body: { ttlMs? }
 * Returns: { ownerToken, resource, projectId, expiresAt }
 * Errors: 422 (invalid params), 423 (lock held by another owner)
 */
skillsRouter.post("/locks/acquire", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const ttlMsRaw = req.body?.ttlMs;
  const ttl = ttlMsRaw !== undefined ? Number(ttlMsRaw) : LOCK_TTL_DEFAULT_MS;
  if (isNaN(ttl) || ttl < LOCK_TTL_MIN_MS || ttl > LOCK_TTL_MAX_MS) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: `ttlMs must be between ${LOCK_TTL_MIN_MS} and ${LOCK_TTL_MAX_MS}ms`,
      },
    });
    return;
  }

  const ownerToken = maintenanceLocks.generateOwnerToken();
  const acquired = maintenanceLocks.acquireLock(LOCK_RESOURCE, projectId, ownerToken, ttl);

  if (!acquired) {
    const existingLock = maintenanceLocks.getLockStatus(LOCK_RESOURCE, projectId);
    const retryAfterMs = existingLock
      ? Math.max(0, new Date(existingLock.expires_at).getTime() - Date.now())
      : LOCK_TTL_DEFAULT_MS;

    // 423 — structured DTO, no token exposure
    const conflictInfo: Record<string, unknown> = { retryAfterMs: Math.ceil(retryAfterMs) };
    if (existingLock) {
      conflictInfo.lock = lockToDto(existingLock);
    }
    res.status(423).json({
      error: {
        code: "LOCKED",
        message: `Resource '${LOCK_RESOURCE}' is locked for this project. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
        ...conflictInfo,
      },
    });
    return;
  }

  // Only acquire response returns the ownerToken
  res.status(201).json({
    data: {
      ownerToken,
      resource: LOCK_RESOURCE,
      projectId,
      expiresAt: new Date(Date.now() + ttl).toISOString(),
    },
  });
});

/**
 * GET /skills/locks — get lock status scoped to the current resolved project.
 * Query: ?project=<name>
 * A global lock on the same resource will be reflected with `scope: "global"`.
 */
skillsRouter.get("/locks", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const lock = maintenanceLocks.getLockStatus(LOCK_RESOURCE, projectId);
  res.json({ data: lock ? lockToDto(lock) : null });
});

/**
 * POST /skills/locks/renew — extend an existing lock's TTL.
 *
 * Query: ?project=<name>
 * Body: { ownerToken, ttlMs? }
 * Returns: { renewed: boolean, expiresAt }
 * Errors: 422 (invalid), 403 (wrong token), 404 (no active lock), 423 (expired)
 */
skillsRouter.post("/locks/renew", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { ownerToken, ttlMs } = req.body || {};
  if (!ownerToken || typeof ownerToken !== "string" || ownerToken.length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "ownerToken is required" } });
    return;
  }
  const extensionMs = ttlMs !== undefined ? Number(ttlMs) : LOCK_TTL_DEFAULT_MS;
  if (isNaN(extensionMs) || extensionMs < LOCK_TTL_MIN_MS || extensionMs > LOCK_TTL_MAX_MS) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: `ttlMs must be between ${LOCK_TTL_MIN_MS} and ${LOCK_TTL_MAX_MS}ms`,
      },
    });
    return;
  }

  const renewed = maintenanceLocks.renewLock(LOCK_RESOURCE, projectId, ownerToken, extensionMs);

  if (!renewed) {
    // Check why it failed: wrong token, expired, or nonexistent
    const existingLock = maintenanceLocks.getLockStatus(LOCK_RESOURCE, projectId);
    if (!existingLock) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "No active lock found to renew." },
      });
    } else if (existingLock.owner_token === ownerToken) {
      // Lock exists with matching token but expired — our renewLock returns false for expired
      res.status(423).json({
        error: { code: "EXPIRED", message: "Lock has expired. Re-acquire a new lock." },
      });
    } else {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Lock exists but owner token does not match. Cannot renew another owner's lock.",
        },
      });
    }
    return;
  }

  res.json({
    data: {
      renewed: true,
      expiresAt: new Date(Date.now() + extensionMs).toISOString(),
    },
  });
});

/**
 * POST /skills/locks/release — release a maintenance lock.
 *
 * Query: ?project=<name>
 * Body: { ownerToken }
 * Returns: { released: boolean }
 * Errors: 422 (missing params), 403 (wrong owner token)
 */
skillsRouter.post("/locks/release", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { ownerToken } = req.body || {};
  if (!ownerToken || typeof ownerToken !== "string" || ownerToken.length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "ownerToken is required" } });
    return;
  }

  const released = maintenanceLocks.releaseLock(LOCK_RESOURCE, projectId, ownerToken);

  if (!released) {
    const existingLock = maintenanceLocks.getLockStatus(LOCK_RESOURCE, projectId);
    if (existingLock) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Lock exists but owner token does not match. Cannot release another owner's lock.",
        },
      });
      return;
    }
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "No active lock found to release." },
    });
    return;
  }

  res.json({ data: { released: true } });
});

// ── Parameterized :name routes (after lock routes to avoid path capture) ─────

/**
 * Router-level guard: validate every :name parameter.
 * Uses the canonical core isSafeSkillName so the rules stay in sync.
 * Express already decodes %2F → `/` and %00 → NUL, so encoded attacks are caught.
 * Static routes (/locks, /proposals, /archived, /search, /sync-all, /consolidate)
 * are declared before this guard and are NOT affected.
 */
skillsRouter.param("name", (_req, res, next, name) => {
  if (!skills.isSafeSkillName(name)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Skill name must be 1-64 characters with no path separators or null bytes" } });
    return;
  }
  next();
});

skillsRouter.get("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const s = skills.getSkill(projectId, req.params.name!);
  if (!s) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
    return;
  }
  res.json({ data: skillToDto(s) });
});

// ── Lock gate middleware for mutation routes ────────────────────────────────

/**
 * Check whether the request holds a valid lock token for the skills resource.
 * Returns true if the request is allowed to proceed (no lock active, or matching token).
 * Sends a 423 response and returns false if the lock is held by another owner.
 *
 * 🔴 423 response DTO must NOT expose owner_token.
 */
function checkSkillLock(req: any, res: any, projectId: string): boolean {
  const activeLock = maintenanceLocks.getLockStatus(LOCK_RESOURCE, projectId);

  if (!activeLock) return true;

  const requestToken = (req.headers["x-ingenium-lock-token"] as string) || "";

  if (requestToken === activeLock.owner_token) {
    return true;
  }

  const retryAfterMs = Math.max(0, new Date(activeLock.expires_at).getTime() - Date.now());
  res.status(423).json({
    error: {
      code: "LOCKED",
      message: `Resource '${LOCK_RESOURCE}' is locked. Provide a valid x-ingenium-lock-token header or retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
      retryAfterMs: Math.ceil(retryAfterMs),
      lock: lockToDto(activeLock),
    },
  });
  return false;
}

// ── Mutation routes (lock-gated) ────────────────────────────────────────────

skillsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const { name, description, content, category, tags, always_apply, files } = req.body;
  // Validate name before passing to core
  if (!skills.isSafeSkillName(name)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Skill name must be 1-64 characters with no path separators or null bytes" } });
    return;
  }
  if (!skills.isValidSkillFileTree(files)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "files must be a JSON string representing a non-array object with string values" } });
    return;
  }
  const result = skills.createSkill(projectId, name, description, content, category, tags, always_apply, files);
  res.status(201).json({ data: skillToDto(result) });
});

skillsRouter.patch("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const { content, description, tags, always_apply, files } = req.body;
  if (files !== undefined && !skills.isValidSkillFileTree(files)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "files must be a JSON string representing a non-array object with string values" } });
    return;
  }
  const updated = skills.updateSkill(projectId, req.params.name!, content, description, tags, always_apply, files);
  if (!updated) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
    return;
  }
  res.json({ data: skillToDto(updated) });
});

/**
 * DELETE /:name — archive (soft-delete) a skill.
 *
 * Backward-compatible: returns 204 on success. The skill is now archived (not hard-deleted).
 * To permanently remove a skill's history, use a governance proposal with type "archive".
 * Archived skills can be restored via POST /:name/restore.
 */
skillsRouter.delete("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const deleted = skills.deleteSkill(projectId, req.params.name);
  if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } }); return; }
  res.status(204).send();
});

skillsRouter.post("/:name/enable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const s = skills.enableSkill(projectId, req.params.name);
  if (!s) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } }); return; }
  res.json({ data: skillToDto(s) });
});

skillsRouter.post("/:name/disable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const s = skills.disableSkill(projectId, req.params.name);
  if (!s) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } }); return; }
  res.json({ data: skillToDto(s) });
});

skillsRouter.post("/:name/sync", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const s = skills.syncSkillFromDisk(projectId, req.params.name);
  if (!s) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found on disk` } }); return; }
  res.json({ data: skillToDto(s) });
});

// ── Governance mutation routes on :name (lock-gated) ─────────────────────────

/** POST /:name/archive — archive (soft-delete) a skill via governance. */
skillsRouter.post("/:name/archive", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const archived = skills.archiveSkill(projectId, req.params.name!);
  if (!archived) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found or already archived` } });
    return;
  }
  res.json({ data: skillToDto(archived) });
});

/** POST /:name/restore — restore an archived skill. */
skillsRouter.post("/:name/restore", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const restored = skills.restoreSkill(projectId, req.params.name!);
  if (!restored) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found or not archived` } });
    return;
  }
  res.json({ data: skillToDto(restored) });
});

/** GET /:name/versions — list all version snapshots for a skill. Verifies project ownership. */
skillsRouter.get("/:name/versions", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const s = skills.getSkill(projectId, req.params.name!);
  if (!s) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
    return;
  }
  const versions = skills.getSkillVersions(s.id);
  res.json({ data: versions.map(versionToDto), total: versions.length });
});

/** GET /:name/versions/:revision — get a specific version snapshot. Verifies project ownership. */
skillsRouter.get("/:name/versions/:revision", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const s = skills.getSkill(projectId, req.params.name!);
  if (!s) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
    return;
  }
  const revision = Number(req.params.revision);
  if (isNaN(revision) || revision < 0 || !Number.isInteger(revision)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "revision must be a non-negative integer" } });
    return;
  }
  const version = skills.getSkillVersion(s.id, revision);
  if (!version) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Version ${revision} of '${req.params.name}' not found` } });
    return;
  }
  res.json({ data: versionToDto(version) });
});

/** POST /:name/rollback — rollback a skill to a prior revision (lock-gated). Body: { revision: number }. */
skillsRouter.post("/:name/rollback", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const { revision } = req.body || {};
  if (revision === undefined || revision === null || typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "revision is required (non-negative integer)" } });
    return;
  }

  const rolled = skills.rollbackSkill(projectId, req.params.name!, revision);
  if (!rolled) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' or version ${revision} not found` } });
    return;
  }
  res.json({ data: skillToDto(rolled) });
});

/** GET /:name/lineage — get the full lineage tree for a skill. Verifies project ownership. */
skillsRouter.get("/:name/lineage", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const s = skills.getSkill(projectId, req.params.name!);
  if (!s) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
    return;
  }
  const lineage = skillGovernance.resolveLineage(s.id, projectId);
  res.json({ data: lineage.map(lineageToDto), total: lineage.length });
});

interface SyncDetail {
  name: string;
  status: "created" | "updated" | "unchanged" | "skipped_archived" | "error";
  revision: number;
}

// GET /sync-all/preview — preview what sync-all would do without modifying anything
skillsRouter.get("/sync-all/preview", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const skillsDir = getSkillsBase(projectId);
  let willCreate: string[] = [];
  let willUpdate: string[] = [];
  let willSkip: string[] = [];
  let errors: string[] = [];

  try {
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const skillMdPath = path.join(skillsDir, e.name, "SKILL.md");
          if (!fs.existsSync(skillMdPath)) continue;

          const existing = skills.getSkill(projectId, e.name);

          if (!existing) {
            willCreate.push(e.name);
          } else if (existing.archived_at) {
            willSkip.push(e.name);
          } else {
            // Compare disk content against DB to predict whether sync would update
            try {
              const rawContent = fs.readFileSync(skillMdPath, "utf-8");
              const parsedContent = skills.stripLeadingFrontmatter(rawContent);
              if (parsedContent === existing.content) {
                willSkip.push(e.name);
              } else {
                willUpdate.push(e.name);
              }
            } catch {
              willSkip.push(e.name);
            }
          }
        }
      }
    }
  } catch (err: any) {
    errors.push(`Failed to scan skills dir: ${err.message}`);
  }

  res.json({
    data: {
      will_create: willCreate,
      will_update: willUpdate,
      will_skip: willSkip,
      total: willCreate.length + willUpdate.length + willSkip.length,
      errors: errors.length > 0 ? errors : undefined,
    },
  });
});

// POST /sync-all — sync ALL skills disk→DB for a project
// Optional ?write_to_disk=true to also push DB skills back to disk
skillsRouter.post("/sync-all", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  const skillsDir = getSkillsBase(projectId);
  const writeToDisk = req.query.write_to_disk === "true";

  let syncedToDb = 0;
  let unchanged = 0;
  let writtenToDisk = 0;
  let errors: string[] = [];
  let details: SyncDetail[] = [];

  // Phase 1: Sync every disk skill → DB (syncSkillFromDisk is idempotent)
  try {
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const skillMdPath = path.join(skillsDir, e.name, "SKILL.md");
          if (!fs.existsSync(skillMdPath)) continue;
          try {
            const existingBefore = skills.getSkill(projectId, e.name);
            const synced = skills.syncSkillFromDisk(projectId, e.name);

            if (!synced) {
              errors.push(`Disk sync failed: ${e.name}`);
              details.push({ name: e.name, status: "error", revision: 0 });
            } else if (synced.archived_at) {
              unchanged++;
              details.push({ name: e.name, status: "skipped_archived", revision: synced.revision });
            } else if (!existingBefore) {
              syncedToDb++;
              details.push({ name: e.name, status: "created", revision: synced.revision });
            } else if (synced.revision > existingBefore.revision) {
              syncedToDb++;
              details.push({ name: e.name, status: "updated", revision: synced.revision });
            } else {
              unchanged++;
              details.push({ name: e.name, status: "unchanged", revision: synced.revision });
            }
          } catch (err: any) {
            errors.push(`Disk sync error: ${e.name} — ${err.message}`);
            details.push({ name: e.name, status: "error", revision: 0 });
          }
        }
      }
    }
  } catch (err: any) {
    errors.push(`Failed to scan skills dir: ${err.message}`);
  }

  // Phase 2: Optional DB→disk write (only when explicitly requested)
  if (writeToDisk) {
    try {
      writtenToDisk = skills.syncAllSkills(projectId);
    } catch (err: any) {
      errors.push(`Failed to write skills to disk: ${err.message}`);
    }
  }

  res.json({
    data: {
      synced_to_db: syncedToDb,
      unchanged,
      written_to_disk: writtenToDisk,
      errors,
      details,
    },
  });
});

// POST /consolidate — LLM-driven skill audit to merge redundant skills, targeting ≤20
skillsRouter.post("/consolidate", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!checkSkillLock(req, res, projectId)) return;

  try {
    const result = await synthesis.consolidateSkills(projectId);
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: { code: "CONSOLIDATION_ERROR", message: err.message } });
  }
});
