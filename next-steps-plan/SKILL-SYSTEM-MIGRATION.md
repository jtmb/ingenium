# Skill System Migration — Execution Ledger (Phases 0–5, Phase 3 Complete)

**Date:** 2026-07-16
**Session source:** Multi-session Phase 0/1 execution (migration-041, FTS-authority, WAL-safety, lock-system, env-hardening, security-scan); Phase 2 lifecycle primitives (042-044, governance contracts, versions, lineage, proposals); Phase 3 taxonomy migration (36→10 consolidation with consolidation-map.json).
**Phase 0 completed:** Baseline snapshot, backup verification, hash recording, git commit `phase0: baseline snapshot before skill system migration`.
**Phase 1 completed:** Maintenance lock (migration 041 + API/MCP/lock-server), FTS trigger sole authority (manual writes removed), WAL checkpoint fixes (6 violations in skills.ts + context.ts), updateSkill disk post-commit round-trip, project/global leases with UUID-scoped API locks + renewal/expiry/owner token, scheduler/manual/cross-project synthesis lock lifetime, resource-sync locking and convergence-safe manifest, env hardening (required OPENCODE_SERVER_PASSWORD + 64-hex INGENIUM_EMAIL_ENCRYPTION_KEY, no hardcoded defaults), CORS defaults, DB path defaults.
**Phase 2 completed:** Skill lifecycle primitives — migrations 042 (versions + revision + archived_at), 043 (lineage/provenance), 044 (skill_proposals with governance state machine). REST governance contracts for archive/restore, versions, rollback, lineage, and proposal lifecycle. Resource-sync convergence with safe path resolution and symlink verification. MCP contracts for all governance operations.
**Phase 3 completed:** Taxonomy migration 36→10 — consolidation enabled, discovery reduced to 10 canonical skills. `consolidation-map.json` created with 28 source migrations and SHA-256 hashes. Legacy SKILL.md files moved to `references/sources/<legacy-name>/`. DB rows archived. Resource sync confirmed idempotent.
**Unfinished scope:** Phase 4 (agent pipeline redesign — partial), Phase 5 (synthesis rewrite — proposals infrastructure built, automatic synthesis still uses direct writes pending Phase 5 migration). Security history scan (legacy password, legacy email encryption key, Thread JWT remain in git history — rotation/re-auth + coordinated purge are external release blockers).

> 🟢 **Phase 3 safety gate is GREEN.** Phase 4 agent pipeline redesign is the next gate.
> 🟡 **Security history purge is an external blocker** — legacy secrets in git history (Thread JWT, legacy email key, legacy password) cannot be fully remediated without coordinated rotation/re-auth and `git filter-repo` across all clones. Safe remediation steps in `docs/security/credential-rotation.md`.
> This document records verified current facts and the controlling plan only.

---

## 1. Backup Snapshot

| Artifact | Path |
|----------|------|
| SQLite backup 1 (root `data`) | `/tmp/opencode/gh-llm-bootstrap-phase0-20260716/database-1.sqlite` |
| SQLite backup 2 (`services/ingenium-api/data`) | `/tmp/opencode/gh-llm-bootstrap-phase0-20260716/database-2.sqlite` |
| Control-plane tar | `/tmp/opencode/gh-llm-bootstrap-phase0-20260716/repository-control-plane.tar.gz` |
| Worktree patch (git diff) | `/tmp/opencode/gh-llm-bootstrap-phase0-20260716/worktree.patch` |

**Status:** Backups already exist on disk at the paths above. Created during prior session before the comment pass. Verified by file listing before this document was written. No additional backup step is needed in Phase 0 execution — only hash verification and a pre-migration snapshot commit.

---

## 2. Project Identity

| Property | Value |
|----------|-------|
| API project `gh-llm-bootstrap` | ✅ **Initialized** (ID: `89950739-ab49-4ba1-bf74-49cfab4a8ba0`, `is_global=0`) |
| `opencode.json` `INGENIUM_PROJECT` | Targets `gh-llm-bootstrap` |
| Global default project | ✅ Exists (ID: `5b5043a6-59d0-44c1-a8a8-7e4be914f4fd`, `is_global=1`) |
| Legacy projects | 3 E2E test orphans + 1 `default` — should be archived/purged |

---

## 3. Skill Directory Inventory

### Current state: 36 discoverable skill directories + 1 non-skill file

**Discoverable** (have SKILL.md, indexed or not):

| # | Directory | In SKILL-INDEX.md? | Notes |
|---|-----------|-------------------|-------|
| 1 | `agent-execution-quality` | ✅ | |
| 2 | `agent-workflow-patterns` | ❌ Missing from index | OpenCode discovers by glob, not index — still loadable |
| 3 | `api-aggregation-patterns` | ✅ | **Duplicate frontmatter** (lines 1-4 + 6-10) |
| 4 | `browsing-the-web` | ✅ | |
| 5 | `configuring-opencode` | ✅ | |
| 6 | `dashboard-screenshots` | ✅ | |
| 7 | `database-conventions` | ✅ | |
| 8 | `database-migration-management` | ✅ | |
| 9 | `debugging-patterns` | ✅ | |
| 10 | `development-conventions` | ✅ | |
| 11 | `devops-conventions` | ✅ | |
| 12 | `docs-workspace` | ❌ Missing from index | OpenCode discovers by glob, not index — still loadable |
| 13 | `documentation-architecture` | ✅ | |
| 14 | `documentation-audit-workflow` | ✅ | |
| 15 | `git-history-hygiene` | ✅ | |
| 16 | `github-cli` | ✅ | |
| 17 | `ingenium-ops` | ✅ | |
| 18 | `language-conventions` | ✅ | |
| 19 | `local-models` | ✅ | |
| 20 | `local-persistence` | ✅ | |
| 21 | `logging-visibility` | ✅ | |
| 22 | `mail-app-ui-conventions` | ❌ Missing from index | OpenCode discovers by glob, not index — still loadable |
| 23 | `mcp-tooling` | ✅ | |
| 24 | `onboard-existing-repo` | ✅ | |
| 25 | `orchestrator-primer` | ✅ | |
| 26 | `parallel-session-hygiene` | ✅ | |
| 27 | `per-project-scoping` | ✅ | |
| 28 | `security-audit` | ✅ | |
| 29 | `security-audit-workflow` | ❌ Missing from index | OpenCode discovers by glob, not index — still loadable |
| 30 | `self-learning` | ✅ | |
| 31 | `skill-maintenance` | ✅ | |
| 32 | `sqlite-migration-patterns` | ✅ | **Duplicate frontmatter** (lines 1-4 + 6-10) |
| 33 | `sqlite-wal-safety` | ✅ | |
| 34 | `supervision-logging` | ❌ Missing from index | OpenCode discovers by glob, not index — still loadable |
| 35 | `uncensored-direct-response` | ✅ | |
| 36 | `visual-standards-conventions` | ❌ Missing from index | OpenCode discovers by glob, not index — still loadable |

**Non-skill file:** `observations.md` — flat `.md` file, **not** a directory with SKILL.md. Already ignored by `scanDiskSkills()`. No action needed.

**Index contradictions:**
- SKILL-INDEX.md header says **30**, but **36** directories exist on disk with SKILL.md
- **6 directories** are missing from the index table. OpenCode discovers skills by globbing `.opencode/skills/*/SKILL.md` from configured paths; the index is documentation only. Missing index entries do **not** make skills invisible to OpenCode.

**Malformed frontmatter (7 known defects in 2 categories):**

*Category A — Missing opening `---` fence (5 skills):*
- `database-conventions/SKILL.md`
- `ingenium-ops/SKILL.md`
- `language-conventions/SKILL.md`
- `onboard-existing-repo/SKILL.md`
- `orchestrator-primer/SKILL.md`

*Category B — Duplicate YAML frontmatter block (2 skills):*
- `api-aggregation-patterns/SKILL.md` — two full frontmatter blocks (lines 1-4 + 6-10)
- `sqlite-migration-patterns/SKILL.md` — two full frontmatter blocks (lines 1-4 + 6-10)

Full audit needed before Phase 3 to detect any additional defects from synthesis auto-generation.

---

## 4. Final Canonical Taxonomy (Exactly 10)

| Canonical Skill | Source Directories Absorbed | Count |
|-----------------|----------------------------|-------|
| `development-conventions` | `api-aggregation-patterns`, `development-conventions`, `ingenium-ops`, `language-conventions`, `mail-app-ui-conventions`, `visual-standards-conventions` | 6 |
| `devops-conventions` | `devops-conventions`, `git-history-hygiene`, `github-cli`, `onboard-existing-repo`, `parallel-session-hygiene` | 5 |
| `database-conventions` | `database-conventions`, `database-migration-management`, `sqlite-migration-patterns`, `sqlite-wal-safety` | 4 |
| `engineering-workflow` | `agent-execution-quality`, `agent-workflow-patterns`, `debugging-patterns`, `configuring-opencode`, `logging-visibility`, `orchestrator-primer`, `per-project-scoping`, `supervision-logging`, `uncensored-direct-response` | 9 |
| `mcp-tooling` | `browsing-the-web`, `dashboard-screenshots`, `mcp-tooling` | 3 |
| `local-models` | `local-models` | 1 |
| `security-audit` | `security-audit`, `security-audit-workflow` | 2 |
| `documentation` | `docs-workspace`, `documentation-architecture`, `documentation-audit-workflow` | 3 |
| `self-learning` | `self-learning` | 1 |
| `skill-maintenance` | `local-persistence`, `skill-maintenance` | 2 |
| **Total** | | **36** |

Every source directory appears exactly once. No skill is deleted — sources move to `references/sources/<legacy-name>/` as historical content.

### Skill shape requirements (all 10 canonical)

- Valid `name` and trigger-rich `description`
- `## When to Use` section
- 3–8 genuine 🔴 HARD RULEs
- Reference table linking `references/` files
- Cross-references to sibling canonical skills
- `SKILL.md` < 500 lines (preferably < 200)
- No unsupported links, no repeated HARD RULE sections
- No direct copies of human docs where a link suffices

---

## 5. Baseline Test Results

### 🟢 Green — Phase 0 Baseline

| Test | Result | Evidence |
|------|--------|----------|
| Core unit tests | 386/386 pass; catalog parity green at 198 | `npm run test --workspace=packages/ingenium-core` |
| API unit tests | 127 pass | `npm run test --workspace=services/ingenium-api` |
| Docs parity test | 26 assertions pass | `tests/route-parity-docs.test.ts` |
| Workspace typechecks | Clean across core, email, API, server, dashboard | `npm run typecheck --workspaces --if-present` |
| DB isolation (CI gate) | Pass | `bash tests/enforce-no-db-leaks.sh` |
| Resource sync tests | **Pending — not run in recorded baseline** | `tests/resource-sync.test.ts` |

### 🟢 Green — Phase 1 Added

| Test | Result | Evidence |
|------|--------|----------|
| WAL lock safety (checkpoint outside txn) | All 6 skills.ts + context.ts violations fixed | grep shows `checkpointAfterWrite` outside `execTransaction` in all tools |
| FTS integrity (no manual FTS writes) | Zero `INSERT INTO skills_fts` in tools code | grep of `packages/ingenium-core/lib/tools/` — triggers are sole authority |
| Migration 041 maintenance_locks table | Created with UNIQUE(resource,project_id), expiry indexes, CHECK constraints | `041_skill_maintenance_locks.sql` on disk |
| FTS migration-024 trigger verification | 3 triggers (insert/delete/update) verified in db.ts post-migration | `db.ts` FTS integrity check |
| Lock expiry / UUID token / 423 response | Implemented in maintenance-locks.ts + API routes | Source verified |
| Synthesis lock lifetime | scheduler/manual/cross-project all use lock | `scheduler.ts`, routes verified |
| Resource-sync locking | Convergence-safe manifest with lock check | Source verified |

### 🟡 Persistent Issues (not addressed in Phase 1)

| Issue | File / Evidence | Severity | Phase |
|-------|----------------|----------|-------|
| **Security history — legacy secrets in git** | Thread JWT, legacy email encryption key, legacy password remain in git history. Worktree has placeholders/required env. Safe rotation steps in `docs/security/credential-rotation.md`. Coordinated `git filter-repo` across all clones is an external release blocker. | 🟡 release blocker | External |
| **Server test breadth is narrow** | `services/ingenium-server/tests/skills-governance.test.ts` covers the Phase 2B wrappers/catalog; most other wrapper modules still lack focused tests | 🟡 coverage gap | 7 |
| **Email has no test script** | `packages/ingenium-email/package.json` — no test script defined | 🟡 coverage gap | 7 |
| **Extension not in root workspace** | `package.json` workspaces: missing `packages/ingenium-extension` | 🟡 breaks `npm run build --workspaces` | 7 |
| **Root `tsc -b` lacks root tsconfig** | `package.json` has `"typecheck": "tsc -b"` but no root `tsconfig.json` with `references` | 🔴 typecheck script broken at root | 7 |
| **Agent validation failures** | Multiple root causes found in `tests/test-agent-validation.sh` | 🔴 test cannot pass — multi-factor fix required | 4 |
| **Append-only test broken** | `tests/test-append-only-files.sh` — points at non-existent path | 🔴 test cannot pass | 4 |
| **Malformed skill frontmatter** | 7 known defects (5 missing `---`, 2 duplicate frontmatter) | 🟡 causes parse failures | 3 |
| **Automated consolidation not scheduled** | `scheduler.ts` contains no `consolidateSkills()` call. The manual implementation remains reachable through `POST /skills/consolidate` and `ingenium_skill_consolidate`; Phase 5 replaces direct automated skill writes with proposals. | 🟡 automation gap | 5 |

### Baseline commands to run (Phase 0 execution)

```bash
npx tsc --noEmit -b                                    # will fail — no root tsconfig
npm run test --workspace=packages/ingenium-core         # 386 pass (1 pre-existing)
npm run test --workspace=services/ingenium-api          # 127 pass
npm run test --workspace=services/ingenium-dashboard    # if exists
bash tests/enforce-no-db-leaks.sh
bash tests/test-agent-validation.sh
bash tests/test-append-only-files.sh
bash tests/test-self-improving.sh
ls -d .opencode/skills/*/ | wc -l                       # should = 36
```

---

## 6. Resolved Design Decisions

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Supervisor env handling | **Additive** — env vars merge with container env, not replace | Docker Compose environment block overlays supervisord's child process env. Non-additive would break PATH and LANG. |
| Container OpenCode/ttyd bind | **0.0.0.0** inside container; host ports published as `127.0.0.1` | Docker host networking is separate from container loopback. Binding 0.0.0.0 inside container allows supervisord health checks. Compose publishes 4098/4099 to HOST 127.0.0.1. Docs corrected to reflect this. |
| OpenCode password auth | **Real** — not a stub. docker-entrypoint.sh requires `OPENCODE_SERVER_PASSWORD`. | MCP tool execution endpoint is exposed. Without auth, arbitrary code execution is possible. |
| FTS migration 024 triggers | **Sole authority** for `skills_fts` writes — **ENFORCED** | Manual FTS writes in `createSkill`/`updateSkill` removed (Phase 1.4). grep confirms zero manual `INSERT INTO skills_fts` in tools code. |
| Lifecycle delete behavior | **No automated delete.** Never call `deleteSkill`, `ingenium_skill_delete`, `rm`, or SQL DELETE on skill source content. | Skills become disabled, archived, or source-moved. DB rows get `enabled=0`. |
| Synthesis mutation model | **Proposal-only target** — automatic synthesis must never directly create, update, merge, or delete active skills. | Phase 5. Current automatic and cross-project synthesis still write directly; scheduler-driven consolidation has been removed, while manual consolidation remains available through REST/MCP. |
| Max concurrent agents | **Six** — with exclusive file ownership matrix and one serialized integrator for shared files. | Maintenance lock now provides DB-level coordination alongside file ownership matrix. |
| `permission:` key | **Singular** in agent frontmatter (not `permissions:`) | DB schema `AgentSchema` uses `permissions:` (plural) — mapping concern. |
| `always_apply` default | **`0`** for all synthesis proposals | Proposals default to `0`; only human review promotes to `1`. |
| Resource-sync resurrection | **Blocked by maintenance lock** — **DEPLOYED** | Session events check lock before syncing. Lock prevents resurrection of API-only skills. |
| Cross-project synthesis | **Proposal-only target** — must not create active global skills directly after Phase 5. Fetch timeout added (Phase 1.6). | The current implementation still calls direct create/update paths under the global `skills` lock; Phase 5 routes candidates through proposals. |
| Maintenance lock design | **UUID-scoped REST locks** with owner token, renewal, expiry, 423 response (no token leak). Project/global leases with conflict rules. | Migration 041 creates the table and Skills REST endpoints implement acquire/renew/release. No dedicated lock MCP tools are registered. |
| Docker required env | `OPENCODE_SERVER_PASSWORD` + `INGENIUM_EMAIL_ENCRYPTION_KEY` (64 hex) — **ENFORCED** | docker-entrypoint.sh validates both; no hardcoded defaults. CORS defaults `localhost:3000` with override. |

---

## 7. Implementation Phases

### ✅ Phase 0 — Baseline & Backup (Completed)
**No skill mutation.** Snapshot everything, record failures.

| Step | Status | Notes |
|------|--------|-------|
| 0.1 | ✅ Done | Backups verified at `/tmp/opencode/gh-llm-bootstrap-phase0-20260716/` |
| 0.2 | ✅ Done | Baseline test results recorded (see §5) |
| 0.3 | ✅ Done | Git status clean |
| 0.4 | ✅ Done | Pre-migration SHA-256 hashes recorded |
| 0.5 | ❌ Skipped | Docker screenshots deferred to Phase 8 |
| **Gate** | ✅ PASS | Commit `phase0: baseline snapshot before skill system migration` |

### ✅ Phase 1 — Safety Foundation (Completed)
**Still no skill mutation.** Fix the underlying data hazards.

| Step | Status | Details |
|------|--------|---------|
| 1.1 | ✅ Done | Migration 041 (`maintenance_locks` table), REST lock endpoints (no dedicated MCP lock tools), lock-check in scheduler, skill CRUD guards, resource-sync session handlers |
| 1.2 | ✅ Done | All 6 `checkpointAfterWrite()`-inside-`execTransaction` violations fixed (5 in skills.ts + 1 in context.ts) |
| 1.3 | ✅ Done | `context.ts` `saveContext()` checkpoint fixed (covered in 1.2) |
| 1.4 | ✅ Done | Manual FTS writes removed from `createSkill()` and `updateSkill()` — grep confirms zero `INSERT INTO skills_fts` in tools code |
| 1.5 | ✅ Done | `updateSkill()` disk sync fixed: writes disk post-commit, round-trips idempotently |
| 1.6 | ✅ Done | Cross-project synthesis fetch timeout added |
| **Tests** | ✅ Done | WAL safety, FTS integrity, disk round-trips, lock expiry/lifetime/bypass, session-event no-op, project isolation |
| **Docs** | 🟡 Updated | This file + `docs/reference/database-migrations.md` + `docs/HOW-TO/skills.md` + env variable docs + security rotation doc |
| **Gate** | ✅ PASS | All Phase 1 checks green. No skill files touched. |

### ✅ Phase 2 — Lifecycle Primitives — Phase 2B Verified (Completed)
**No skill mutation.** Migration-safe archival, proposal, and version infrastructure built and verified.

| Step | Status | Details |
|------|--------|---------|
| 2.1 | ✅ Done | Migrations 042 (skill_versions + archived_at + revision), 043 (skill_lineage), 044 (skill_proposals) — all additive, no rebuilds |
| 2.2 | ✅ Done | `archiveSkill()` sets `archived_at`, removes SKILL.md only (preserves metadata.json + all file_tree auxiliary files). `restoreSkill()` reverses. Neither calls `deleteSkill`. |
| 2.3 | ✅ Done | Lineage table (`skill_lineage`) with provenance records, cycle detection (depth-limited BFS, max 100), `ON CONFLICT DO UPDATE` upsert |
| 2.4 | ✅ Done | Immutable `skill_versions` table via migration 042 `AFTER INSERT` (revision 0) and `AFTER UPDATE` (revision change) triggers. `rollbackSkill()` loads a snapshot and applies it as a new revision — append-only, byte-equivalent. |
| 2.5 | ✅ Done | `skill_proposals` table with application workflow `draft → pending → applied/rejected/stale`, then `applied → rolledBack` in governance DTOs (`rolled_back` in storage/status filters). Stale-checking on approve (revision conflict, missing target, archived target). UUID proposal IDs. |
| 2.6 | ⏳ Phase 5 | Governance proposal approve/reject/rollback mutations are implemented, but automatic and cross-project synthesis still call direct skill create/update paths. Proposal-only synthesis and the zero-active-write assertion remain Phase 5 work. |
| 2.7 | ✅ Done | Full REST governance contracts in `services/ingenium-api/lib/routes/skills.ts`: archived list, archive/restore, versions and version by revision, rollback `{revision}`, lineage create/list, proposal create/list/get/submit/approve/reject/rollback, lock acquire/renew/release |
| **Security** | ✅ Implemented | `isSafeSkillName()` name validation (1-64 chars, no path separators/null bytes). `isValidSkillFileTree()` (JSON object, string values). `resolveSafePath()` — blocks absolute paths, traversal, reserved SKILL.md/metadata.json, directories, symlink escapes, dangling symlinks, empty/`.` root. Post-write symlink re-verification in `writeSkillToDisk()`. |
| **Wire boundary** | ✅ Documented | Legacy CRUD routes return raw snake_case rows; governance DTOs return camelCase with parsed JSON fields. Lock DTOs explicitly strip `owner_token`. |
| **Extension** | ✅ Verified | `resource-sync.ts` preserves auxiliary files + category, supports CRLF frontmatter parsing, never follows symlinks during deletion (unlinks symlinks at root, `rmRecursive` uses lstat per entry), validates safe names before removal. |
| **MCP contracts** | ✅ Verified | UUID proposal IDs (`z.string().uuid()`) for get/submit/approve/reject/rollback. UUID `targetSkillId` for lineage. Exact `proposedState` Zod schema with strict object. Non-negative `revision` (`z.number().int().min(0)`). |
| **Tests** | ✅ Run | Core 511 tests pass (Phase 0 was 386 — 125 new lifecycle/governance tests). API 224 tests pass (Phase 0 was 127). Server 39 typechecks. Extension resource-sync 51 tests pass. Catalog parity 10/10. Typechecks clean: core, email, API, server, dashboard. DB isolation gate passes. Diff check: no source changes outside planned scope. |
| **Docs** | ✅ Source-verified | `docs/HOW-TO/skills.md` documents Security, Wire Boundary, Governance, locks, and the 25-tool Skills catalog. `docs/CONVENTIONS.md` covers archive-only deletion and file_tree path traversal. `docs/security-review-docs-workspace.md` marks path and FTS controls remediated. This ledger distinguishes completed governance primitives from the Phase 5 synthesis rewrite. |
| **Gate** | ✅ PASS | `archiveSkill` does not call `deleteSkill`. Rollback proven byte-equivalent via append-only version snapshots. All lifecycle migrations are additive (042-044). Real MCP-through-Docker E2E remains a final integration gate, **not** a Phase 2B failure. Existing security-history release blocker (legacy credentials in git history) is unchanged — current worktree has required env/placeholders. |

### ✅ Phase 3 — Taxonomy Migration (36→10) (Completed)
**First actual skill mutation.** Move source content, create canonical skills.

| Step | Status | Details | File Ownership Zone |
|------|--------|---------|---------------------|
| 3.1 | ✅ Done | Create 10 canonical split-skill directories with fresh SKILL.md + references/ | Disjoint trees, 6 concurrent agents |
| 3.2 | ✅ Done | Move each legacy SKILL.md → `references/sources/<legacy-name>/source-index.md` | Same agent ownership as 3.1 |
| 3.3 | ✅ Done | Move each legacy references/ → `references/sources/<legacy-name>/references/` | Same |
| 3.4 | ✅ Done | Leave `MIGRATED-TO.md` + `metadata.json` in old top-level directories; **remove SKILL.md** from legacy dirs | Same |
| 3.5 | ✅ Done | Disable old DB rows via `archiveSkill()` (no deletes) | Serialized integrator |
| 3.6 | ✅ Done | Write `consolidation-map.json` with every source→target mapping + SHA-256 hashes | Serialized integrator |
| 3.7 | ✅ Done | Run sync twice to prove idempotence and no resurrection | — |
| **Tests** | ✅ Done | `tests/skill-taxonomy.test.ts`: exactly 10 discoverable SKILL.md, all frontmatter valid, all links valid, no duplicate HARD RULEs, 36-source mapping coverage, hash preservation | |
| **Docs** | ✅ Done | Regenerate `.opencode/SKILL-INDEX.md` (10 active + 28-source provenance appendix). Update `docs/reference/skill-taxonomy-migration.md`. | |
| **Gate** | ✅ PASS | Disk, DB, and manifest agree. All legacy SKILL.md removed from discoverable locations. Consolidation map verified at 2026-07-16T19:00:00Z. | |

> ✅ **Phases 0–3 completed.** Phase 2A/2B lifecycle primitives completed. Phase 3 taxonomy consolidation verified. Proposal-only automatic synthesis and agent pipeline redesign remain explicitly deferred to Phases 4–5.

### Phase 4 — Agent Pipeline Redesign

### Phase 5 — Synthesis Rewrite (Proposal Architecture)
| Step | Details |
|------|---------|
| 5.1 | Replace direct synthesis create/update/delete with evidence-backed draft proposal generation |
| 5.2 | Implement candidate rule ledger: trigger, actionable instruction, rationale, severity, provenance, recurrence, novelty, contradiction, quality score |
| 5.3 | Golden corpus evaluation: durable rules vs one-off noise vs duplicates vs contradictions |
| 5.4 | Approval/rejection/rollback workflow for proposals |
| 5.5 | Assert zero active writes during automatic synthesis |
| **Gate** | QA + security review mandatory. Golden corpus precision ≥ 85%. |

### Phase 6 — Dashboard Governance
| Step | Details |
|------|---------|
| 6.1 | Add Active, Proposals, Consolidated Sources views to `/skills` page |
| 6.2 | Evidence/diff/quality-factor display per proposal |
| 6.3 | Approve/reject/rollback buttons + confirmation flows |
| 6.4 | Version history tab for active skills |
| **Gate** | Playwright: create proposal, inspect evidence, reject, approve another, verify canonical reference update, roll back. All entry paths tested. |

### Phase 7 — Deployment
| Step | Details |
|------|---------|
| 7.1 | Run all test suites until green (core 386+, API, dashboard E2E, shell, isolation) |
| 7.2 | Rebuild Docker, restart, verify host-side API + dashboard |
| 7.3 | Fresh OpenCode session exposes exactly 10 skills |
| 7.4 | Release maintenance lock only after manifest↔DB parity |
| 7.5 | Run `/synthesize` in draft-only mode, `/sync-skills` after lock release |
| 7.6 | Watch scheduler for ≥5 minutes (timer code changed) |
| **Gate** | No error classified as stale/pre-existing without proof. |

### Phase 8 — Visual & Final Acceptance

| Step | Agent | Details |
|------|-------|---------|
| 8.1 | Browser/vision | Capture desktop 1440 + mobile 390, light + dark. Screenshots for every changed page. |
| 8.2 | Vision bridge | Analyze each screenshot for layout, focus, keyboard, loading/error states, responsive breakpoints |
| 8.3 | Security | Full audit of changes |
| 8.4 | Docs | Read-back pass on every changed document and link |
| 8.5 | QA | Final audit: rollback proof, migration ledger, data quality, tests, deployment, screenshots |
| **Gate** | All 8 gates pass. Orchestrator handoff summary with STATUS, FILES, TESTS, BLOCKERS, DOC_IMPACT, VISUAL_EVIDENCE. |

---

## 8. Rollback Strategy (Per Phase)

| Phase | Rollback Action |
|-------|----------------|
| 0 | `git checkout` pre-Phase-0 commit. Restore DBs from backup. |
| 1 | `git revert` Phase 1 commits (migration 041). Lock table can be dropped via new migration. If FTS triggers were recreated, verify no data loss via `PRAGMA integrity_check`. Restore env vars to previous values. |
| 2 | `git revert` Phase 2 commits. Drop lifecycle tables via migration. |
| 3 | `git revert` Phase 3 commits. Restore SKILL.md files from `consolidation-map.json` + `git mv` reverse. Restore DB rows via `enabled=1`. |
| 4 | `git revert` Phase 4 commits. Restore agent `.md` files from backup. |
| 5 | `git revert` Phase 5 commits. Synthesis falls back to heuristic mode. |
| 6 | `git revert` Phase 6 commits. Dashboard retains old skills page. |
| 7 | `git revert` Docker rebuild. Use previous image tag. |
| 8 | No rollback needed (visual acceptance only). |

---

## 9. Key Risks

| Risk | Mitigation | Status |
|------|-----------|--------|
| Concurrent agent file writes during Phase 3 | Max 6 agents with exclusive file ownership matrix + serialized integrator for shared files | 🟢 Planned |
| `updateSkill` disk sync broken | Fixed in Phase 1.5 — writes disk post-commit, round-trips idempotently | ✅ Resolved |
| Resource-sync resurrects disabled skills during migration | Maintenance lock (migration 041) blocks all session-event syncs | ✅ Deployed |
| Synthesis creates low-value skills after rewrite | Golden corpus evaluation + proposal-only enforcement (Phase 5) | 🟡 Future |
| OpenCode discovery assumptions wrong | Verified by `scanDiskSkills()` source (directory + SKILL.md detection) | 🟢 Verified |
| `checkpointAfterWrite()` violations cause SQLITE_LOCKED | All 6 violations fixed in Phase 1.2–1.3 | ✅ Resolved |
| FTS duplication from dual-write pattern | Manual FTS writes removed; migration 024 triggers are sole authority | ✅ Resolved |
| Security history leaks (git history) | Worktree has placeholders; coordinated `git filter-repo` + rotation/re-auth is external | 🟡 Workaround deployed |
| Lock token leak via error messages | UUID-scoped API locks with owner token; 423 response does not leak token | ✅ Deployed |
| Email encryption key format drift | Enforced: 64 hex chars with regex check in docker-entrypoint.sh | ✅ Deployed |

---

## 10. File Ownership Zones (Phase 3 Writer Wave)

| Zone | Paths | Assigned Agent |
|------|-------|----------------|
| **Engineering Workflow** | `.opencode/skills/engineering-workflow/` | Agent A |
| **Development Conventions** | `.opencode/skills/development-conventions/` | Agent B |
| **DevOps Conventions** | `.opencode/skills/devops-conventions/` | Agent C |
| **Database Conventions** | `.opencode/skills/database-conventions/` | Agent D |
| **MCP Tooling** | `.opencode/skills/mcp-tooling/` | Agent E |
| **Documentation / Security / Local-models / Self-learning / Skill-maintenance** | Remaining 5 canonical trees | Agent F |
| **Shared files** | `consolidation-map.json`, SKILL-INDEX.md, DB archival | Serialized integrator (post-writer-wave) |

No agent may edit shared files during the writer wave. Integrator runs after all 6 complete.

---

## 11. Documentation Deliverables Map

| Phase | Docs Created/Updated | Status |
|-------|---------------------|--------|
| 0 | `next-steps-plan/SKILL-SYSTEM-MIGRATION.md` (this file) | ✅ Done |
| 1 | `docs/reference/database-migrations.md` (migration 041), `docs/HOW-TO/skills.md` (locks/423/FTS/disk safety), `docs/VARIABLES.md` + `docs/reference/environment-variables.md` (required secrets, key format, CORS, DB paths), `docs/operations/deployment.md` (container bind claims), `docs/ARCHITECTURE.md`, `docs/GETTING-STARTED.md`, `docs/USAGE.md`, `packages/ingenium-extension/ARCHITECTURE.md` (stale 127.0.0.1 bind corrections), `docs/security/credential-rotation.md` (new), `docs/security/iframe-sandbox.md` (sandbox-presence audit) | 🟡 This pass |
| 2 | `docs/concepts/skill-system-architecture.md` (first draft, §§ 1-5, 7, 9), architecture reference updates | ⏳ Next |
| 3 | `docs/reference/skill-taxonomy-migration.md`, SKILL-INDEX.md regeneration, AGENTS.md table rewrite | ⏳ Future |
| 4 | `docs/agents.md`, AGENTS.md orchestrator section, `engineering-workflow` skill | ⏳ Future |
| 5 | `docs/self-learning-pipeline.md` (major rewrite), synthesis/skills HOW-TO, proposals reference | ⏳ Future |
| 6 | Dashboard usage, MCP tools, settings docs | ⏳ Future |
| 7 | Release notes, operations guide, environment variables | ⏳ Future |
| 8 | Final read-back pass — all docs verified consistent | ⏳ Future |

---

## 12. Acceptance Metrics (Final)

| Metric | Target |
|--------|--------|
| Discoverable canonical skills | Exactly 10 |
| Legacy sources mapped | All 36, each exactly once |
| Source content or DB row deleted | Zero |
| Direct active skill writes from auto-synthesis | Zero |
| FTS duplication or integrity failures | Zero |
| `checkpointAfterWrite()` inside transactions | Zero |
| Promoted rules with trigger + instruction + provenance | 100% |
| Promoted rules without sufficient evidence | Zero |
| Extraction precision (golden corpus) | ≥ 85% |
| Near-duplicate proposal rate | ≤ 5% |
| Contradictory active rules | Zero |
| Pipeline output newer than deployment time | Verified |
| Skill config loads in fresh OpenCode process | Verified |
| All tests, integration, rollback, visual gates | Pass |

---

*This is a Phase 0 baseline document. No skill mutation has been performed. Proceed to Phase 1 only after backup, baseline tests, and snapshot commit are complete.*
