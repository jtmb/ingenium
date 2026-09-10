-- Migration 044: Skill proposals — review/approval workflow for skill mutations.
--
-- Purpose:
--   Provide a governance layer for skill changes. Proposals capture the complete
--   intended state of a skill change (create, update, merge, or archive) along with
--   evidence and metadata, then go through a review workflow (draft → pending →
--   applied/rejected/stale).
--
-- Design:
--   - A single `skill_proposals` table supports all mutation types.
--   - `proposed_state` is a JSON object containing the complete skill state to be applied.
--   - `expected_revision` prevents stale application — if the target skill's current
--     revision doesn't match when the proposal was created, the proposal is marked stale.
--   - `target_revision_before` / `source_revision_before` / `target_created` capture
--     pre-apply state for safe rollback (approval sets these before mutating).
--   - `candidate_group_key` is an application-level dedup key. The UNIQUE partial index
--     on (project_id, candidate_group_key) WHERE candidate_group_key IS NOT NULL AND
--     status IN ('draft','pending') provides race-safe dedup.
--   - `evidence_json` stores observation IDs and quality/novelty/contradiction scores as JSON.
--   - CHECK constraints enforce valid statuses.
--   - `always_apply` for automatic proposals defaults to 0 per requirement.
--
-- Guard: checked in db.ts by probing for `skill_proposals` table existence.

CREATE TABLE IF NOT EXISTS skill_proposals (
    -- 044_proposals
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'pending', 'rejected', 'applied', 'rolled_back', 'stale')),
    proposal_type TEXT NOT NULL
        CHECK(proposal_type IN ('create', 'update', 'merge', 'archive')),
    -- Target identification
    target_skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL,
    target_name TEXT NOT NULL,
    source_project_id TEXT DEFAULT NULL,
    source_name TEXT DEFAULT NULL,
    expected_revision INTEGER DEFAULT NULL,
    expected_source_revision INTEGER DEFAULT NULL,
    -- Pre-apply state references (captured at approval time, used for rollback)
    target_revision_before INTEGER DEFAULT NULL,
    source_revision_before INTEGER DEFAULT NULL,
    target_created INTEGER DEFAULT 0 CHECK(target_created IN (0, 1)),
    -- Proposed complete state (JSON object matching SkillSchema fields)
    proposed_state TEXT NOT NULL,
    -- Evidence and quality metrics
    evidence_json TEXT NOT NULL DEFAULT '[]',
    observation_ids TEXT NOT NULL DEFAULT '[]',
    quality_score REAL DEFAULT 0.0
        CHECK(quality_score >= 0.0 AND quality_score <= 1.0),
    novelty_score REAL DEFAULT 0.0
        CHECK(novelty_score >= 0.0 AND novelty_score <= 1.0),
    contradiction_flag INTEGER DEFAULT 0
        CHECK(contradiction_flag IN (0, 1)),
    candidate_group_key TEXT DEFAULT NULL,
    -- Review metadata
    reviewer TEXT DEFAULT NULL,
    review_reason TEXT DEFAULT NULL,
    always_apply INTEGER NOT NULL DEFAULT 0,
    -- Timestamps
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    reviewed_at TEXT,
    applied_at TEXT,
    rolled_back_at TEXT
);

-- Index for listing proposals by project + status (most common UI query)
CREATE INDEX IF NOT EXISTS idx_skill_proposals_project_status ON skill_proposals(project_id, status);

-- Index for target-skill lookups (find proposals for a specific skill)
CREATE INDEX IF NOT EXISTS idx_skill_proposals_target ON skill_proposals(target_skill_id);

-- Race-safe dedup: UNIQUE partial index prevents concurrent insertion of duplicate
-- candidate proposals in any active review status (draft, pending).
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_proposals_candidate_uniq
    ON skill_proposals(project_id, candidate_group_key)
    WHERE candidate_group_key IS NOT NULL AND status IN ('draft', 'pending');

-- Index for stale detection queries
CREATE INDEX IF NOT EXISTS idx_skill_proposals_type ON skill_proposals(proposal_type);
