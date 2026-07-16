import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import { getDb, verifyAndRebuildSkillsFts, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";

// ============================================================
// Static regression: verify checkpointAfterWrite is NEVER textually
// inside an execTransaction callback in owned source files.
// ============================================================

/**
 * Find all line numbers where checkpointAfterWrite appears textually
 * between an execTransaction( call and its matching }); close.
 *
 * Heuristic: for each `checkpointAfterWrite` occurrence, look backward
 * to see whether the most recent `execTransaction(` or the most recent
 * `});` is closer. If `execTransaction(` is more recent (or there is no
 * `});` between them), checkpointAfterWrite is inside a transaction callback.
 */
function findCheckpointInsideTransaction(filePath: string): number[] {
  const content = readFileSync(filePath, "utf-8");
  const violations: number[] = [];

  const cpRegex = /checkpointAfterWrite/g;
  let match: RegExpExecArray | null;
  while ((match = cpRegex.exec(content)) !== null) {
    const pos = match.index;
    const before = content.slice(0, pos);
    const lastTx = before.lastIndexOf("execTransaction(");
    const lastClose = before.lastIndexOf("});");

    // If execTransaction( appears after the last }); (or there is no }); at all),
    // then we're still inside the execTransaction callback when checkpointAfterWrite appears.
    if (lastTx > lastClose) {
      violations.push(content.slice(0, pos).split("\n").length);
    }
  }

  return violations;
}

describe("Static WAL safety — no checkpointAfterWrite inside execTransaction callbacks", () => {
  // Owned source files that must never have checkpointAfterWrite inside execTransaction
  const OWNED_FILES = [
    "packages/ingenium-core/lib/tools/skills.ts",
    "packages/ingenium-core/lib/tools/context.ts",
    "packages/ingenium-core/lib/tools/maintenance-locks.ts",
  ];

  const workspaceRoot = pathResolve(import.meta.dirname ?? __dirname, "../../..");

  for (const relativePath of OWNED_FILES) {
    it(`${relativePath} has zero checkpoint-inside-transaction violations`, () => {
      const fullPath = pathResolve(workspaceRoot, relativePath);
      const violations = findCheckpointInsideTransaction(fullPath);
      expect(
        violations,
        `checkpointAfterWrite found inside execTransaction callback at lines: [${violations.join(", ")}] in ${relativePath}`,
      ).toEqual([]);
    });
  }
});

// ============================================================
// FTS infrastructure failure test: verifyAndRebuildSkillsFts
// throws actionable errors when triggers or virtual table are missing.
// ============================================================

describe("FTS infrastructure — verifyAndRebuildSkillsFts throws on missing components", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-fts-fail-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Reset the DB singleton before each test so each gets a fresh connection
  beforeEach(() => {
    resetDbForTest();
  });

  /**
   * Helper: create a fresh DB with all migrations through 041,
   * then return the db handle. Resets singleton first to ensure
   * a fresh connection to the requested path.
   */
  function createFullyMigratedDb(dbPath: string) {
    // Ensure clean singleton state for a fresh connection
    resetDbForTest();
    process.env.INGENIUM_CORE_DB_PATH = dbPath;
    const project = createProject("fts-fail-test-project");
    const db = getDb(dbPath);
    return { db, projectId: project.id };
  }

  it("succeeds when all FTS infrastructure is present", () => {
    const dbPath = join(tempDir, "test-fts-ok.db");
    const { db } = createFullyMigratedDb(dbPath);
    // Should not throw
    expect(() => verifyAndRebuildSkillsFts(db)).not.toThrow();
  });

  it("throws when skills_fts virtual table is missing", () => {
    const dbPath = join(tempDir, "test-fts-no-table.db");
    const { db } = createFullyMigratedDb(dbPath);
    // Drop the virtual table
    db.prepare("DROP TABLE IF EXISTS skills_fts").run();
    expect(() => verifyAndRebuildSkillsFts(db)).toThrow(/skills_fts.*missing/i);
  });

  it("throws when skills_fts_insert trigger is missing", () => {
    const dbPath = join(tempDir, "test-fts-no-insert.db");
    const { db } = createFullyMigratedDb(dbPath);
    db.prepare("DROP TRIGGER IF EXISTS skills_fts_insert").run();
    expect(() => verifyAndRebuildSkillsFts(db)).toThrow(/skills_fts_insert.*missing/i);
  });

  it("throws when skills_fts_delete trigger is missing", () => {
    const dbPath = join(tempDir, "test-fts-no-delete.db");
    const { db } = createFullyMigratedDb(dbPath);
    db.prepare("DROP TRIGGER IF EXISTS skills_fts_delete").run();
    expect(() => verifyAndRebuildSkillsFts(db)).toThrow(/skills_fts_delete.*missing/i);
  });

  it("throws when skills_fts_update trigger is missing", () => {
    const dbPath = join(tempDir, "test-fts-no-update.db");
    const { db } = createFullyMigratedDb(dbPath);
    db.prepare("DROP TRIGGER IF EXISTS skills_fts_update").run();
    expect(() => verifyAndRebuildSkillsFts(db)).toThrow(/skills_fts_update.*missing/i);
  });

  it("throws actionable error (mentions migration 024)", () => {
    const dbPath = join(tempDir, "test-fts-actionable.db");
    const { db } = createFullyMigratedDb(dbPath);
    db.prepare("DROP TABLE IF EXISTS skills_fts").run();
    let errorMsg = "";
    try {
      verifyAndRebuildSkillsFts(db);
    } catch (e: any) {
      errorMsg = e.message;
    }
    // The error must guide the operator to run migration 024
    expect(errorMsg).toMatch(/024|migration|FTS5 trigger/i);
  });
});
