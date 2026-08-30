import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import ts from "typescript";
import { getDb, verifyAndRebuildSkillsFts, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";

function findCheckpointInsideTransaction(filePath: string): number[] {
  const content = readFileSync(filePath, "utf-8");
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: number[] = [];

  const visit = (node: ts.Node, insideTransaction = false): void => {
    const isCall = ts.isCallExpression(node) && ts.isIdentifier(node.expression);
    const isTransaction = isCall && node.expression.text === "execTransaction";
    if (insideTransaction && isCall && node.expression.text === "checkpointAfterWrite") {
      violations.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, (child) => visit(child, insideTransaction || isTransaction));
  };
  visit(source);

  return violations;
}

/** Extract simple `execTransaction(() => { ... });` callback bodies for static guards. */
function transactionBodies(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  return [...content.matchAll(/execTransaction\(\(\) => \{([\s\S]*?)\n\s*\}\);/g)]
    .map((match) => match[1]!);
}

const FILESYSTEM_CALLS = [
  "readFileSync",
  "writeFileSync",
  "unlinkSync",
  "existsSync",
  "lstatSync",
  "mkdirSync",
] as const;

/**
 * Return the body of every locally declared helper. This lets the static guard
 * follow transaction → helper → filesystem paths instead of only rejecting a
 * filesystem import that appears directly in a callback.
 */
function localFunctionBodies(source: string): Map<string, string> {
  const functions = new Map<string, string>();
  const declaration = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^\{]+)?\{/g;
  let match: RegExpExecArray | null;

  while ((match = declaration.exec(source)) !== null) {
    let depth = 1;
    let cursor = declaration.lastIndex;
    for (; cursor < source.length && depth > 0; cursor += 1) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
    }
    if (depth === 0) functions.set(match[1]!, source.slice(declaration.lastIndex, cursor - 1));
  }

  return functions;
}

function containsCall(body: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(body);
}

function reachesFilesystem(
  name: string,
  functions: Map<string, string>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const body = functions.get(name);
  if (!body) return false;
  if (FILESYSTEM_CALLS.some((call) => containsCall(body, call))) return true;
  return [...functions.keys()].some((helper) => containsCall(body, helper)
    && reachesFilesystem(helper, functions, new Set(seen)));
}

const workspaceRoot = pathResolve(import.meta.dirname ?? __dirname, "../../..");

describe("Static WAL safety — no checkpointAfterWrite inside execTransaction callbacks", () => {
  // Owned source files that must never have checkpointAfterWrite inside execTransaction
  const OWNED_FILES = [
    "packages/ingenium-core/lib/tools/skills.ts",
    "packages/ingenium-core/lib/tools/context.ts",
    "packages/ingenium-core/lib/tools/context-snapshot-import.ts",
    "packages/ingenium-core/lib/tools/email-watcher-markers.ts",
    "packages/ingenium-core/lib/tools/maintenance-locks.ts",
    "packages/ingenium-core/lib/tools/coordination.ts",
    "packages/ingenium-core/lib/tools/trusted-job-events.ts",
    "packages/ingenium-core/lib/tools/job-event-deliveries.ts",
  ];

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

describe("Static WAL safety — agent lifecycle disk writes happen after commit", () => {
  it("keeps direct and helper-mediated agent filesystem mutations outside execTransaction callbacks", () => {
    const filePath = pathResolve(workspaceRoot, "packages/ingenium-core/lib/tools/agents.ts");
    const source = readFileSync(filePath, "utf-8");
    const functions = localFunctionBodies(source);
    const filesystemHelpers = [...functions.keys()].filter((helper) =>
      reachesFilesystem(helper, functions),
    );
    const violations = transactionBodies(filePath).flatMap((body, transactionIndex) => {
      const directCalls = FILESYSTEM_CALLS.filter((call) => containsCall(body, call))
        .map((call) => `transaction ${transactionIndex + 1} directly calls ${call}`);
      const indirectCalls = filesystemHelpers.filter((helper) => containsCall(body, helper))
        .map((helper) => `transaction ${transactionIndex + 1} reaches filesystem through ${helper}`);
      return [...directCalls, ...indirectCalls];
    });

    expect(violations).toEqual([]);
  });
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
