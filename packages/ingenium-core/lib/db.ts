import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "./logger.js";

const WRITE_MAX_RETRIES = 15;
const WRITE_RETRY_MIN_MS = 20;
const WRITE_RETRY_MAX_MS = 150;

let db: Database.Database | null = null;

export function getDb(dbPath: string): Database.Database {
  if (db) return db;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  // Check if we need to initialize the schema
  const tableCount = db.prepare(
    "SELECT count(*) as count FROM sqlite_master WHERE type='table'",
  ).get() as { count: number };

  if (tableCount.count === 0) {
    const migrationPath = resolve(
      import.meta.dirname ?? __dirname,
      "../data/migrations/001_init.sql",
    );
    const sql = readFileSync(migrationPath, "utf-8");
    db.exec(sql);
    logger.info("Database initialized with migration 001_init.sql");
  } else {
    logger.debug("Database already initialized, skipping migration");
  }
}

export function execTransaction<T>(fn: () => T, retries = WRITE_MAX_RETRIES): T {
  // Ensure DB is initialized before transaction
  if (!db) {
    db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = db!.transaction(fn)();
      return result;
    } catch (err) {
      if (
        attempt < retries - 1 &&
        err instanceof Error &&
        (err.message.includes("SQLITE_BUSY") || err.message.includes("SQLITE_LOCKED"))
      ) {
        const delay = WRITE_RETRY_MIN_MS + Math.random() * (WRITE_RETRY_MAX_MS - WRITE_RETRY_MIN_MS);
        logger.warn({ attempt, delay }, "DB contention, retrying");
        sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Transaction failed after max retries");
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// WAL checkpoint every 50 writes
let writeCount = 0;
export function checkpointAfterWrite(): void {
  writeCount++;
  if (writeCount >= 50) {
    db?.pragma("wal_checkpoint(PASSIVE)");
    writeCount = 0;
  }
}
