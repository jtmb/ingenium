import Database from "better-sqlite3";
import { resolveCoreDbPath } from "./db.js";

export interface DatabaseIntegrityResult {
  ok: boolean;
  integrityViolationCount: number;
  foreignKeyViolationCount: number;
}

function failedResult(): DatabaseIntegrityResult {
  return { ok: false, integrityViolationCount: 1, foreignKeyViolationCount: 1 };
}

export function checkDatabaseIntegrity(databasePath?: string): DatabaseIntegrityResult {
  let database: Database.Database;
  try {
    database = new Database(resolveCoreDbPath(databasePath), { readonly: true, fileMustExist: true });
  } catch {
    return failedResult();
  }

  try {
    let integrityViolationCount = 1;
    let foreignKeyViolationCount = 1;
    try {
      const rows = database.pragma("integrity_check") as Array<{ integrity_check?: unknown }>;
      integrityViolationCount = rows.length === 1 && rows[0]?.integrity_check === "ok"
        ? 0
        : Math.max(rows.length, 1);
    } catch {
      integrityViolationCount = 1;
    }
    try {
      const rows = database.pragma("foreign_key_check") as unknown[];
      foreignKeyViolationCount = rows.length;
    } catch {
      foreignKeyViolationCount = 1;
    }
    return {
      ok: integrityViolationCount === 0 && foreignKeyViolationCount === 0,
      integrityViolationCount,
      foreignKeyViolationCount,
    };
  } finally {
    database.close();
  }
}
