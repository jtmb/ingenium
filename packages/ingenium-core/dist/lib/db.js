import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "./logger.js";
const WRITE_MAX_RETRIES = 15;
const WRITE_RETRY_MIN_MS = 20;
const WRITE_RETRY_MAX_MS = 150;
let db = null;
export function getDb(dbPath) {
    if (db)
        return db;
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
function runMigrations(db) {
    const migrationsDir = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    // Check if we need to initialize the schema
    const tableCount = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table'").get();
    if (tableCount.count === 0) {
        // Fresh DB — run all migrations in order
        for (const file of ["001_init.sql", "002_archive.sql", "003_agents.sql", "004_learnings_status.sql", "005_skills_metadata.sql", "006_skill_file_tree.sql"]) {
            const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
            db.exec(sql);
            logger.info(`Applied migration ${file}`);
        }
    }
    else {
        // Check if archived_at column exists (migration 002)
        const colCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('projects') WHERE name = 'archived_at'").get();
        if (colCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "002_archive.sql"), "utf-8");
            db.exec(sql);
            logger.info("Applied migration 002_archive.sql");
        }
        // Check if agents table exists (migration 003)
        const agentsCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='agents'").get();
        if (agentsCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "003_agents.sql"), "utf-8");
            db.exec(sql);
            logger.info("Applied migration 003_agents.sql");
        }
        // Check if status column exists on learnings (migration 004)
        const statusColCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('learnings') WHERE name = 'status'").get();
        if (statusColCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "004_learnings_status.sql"), "utf-8");
            db.exec(sql);
            logger.info("Applied migration 004_learnings_status.sql");
        }
        // Check if tags column exists on skills (migration 005)
        const tagsColCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('skills') WHERE name = 'tags'").get();
        if (tagsColCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "005_skills_metadata.sql"), "utf-8");
            db.exec(sql);
            logger.info("Applied migration 005_skills_metadata.sql");
        }
        // Check if file_tree column exists on skills (migration 006)
        const fileTreeCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('skills') WHERE name = 'file_tree'").get();
        if (fileTreeCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "006_skill_file_tree.sql"), "utf-8");
            db.exec(sql);
            logger.info("Applied migration 006_skill_file_tree.sql");
        }
    }
}
export function execTransaction(fn, retries = WRITE_MAX_RETRIES) {
    // Ensure DB is initialized before transaction
    if (!db) {
        db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    }
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const result = db.transaction(fn)();
            return result;
        }
        catch (err) {
            if (attempt < retries - 1 &&
                err instanceof Error &&
                (err.message.includes("SQLITE_BUSY") || err.message.includes("SQLITE_LOCKED"))) {
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
function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
// WAL checkpoint every 50 writes
let writeCount = 0;
export function checkpointAfterWrite() {
    writeCount++;
    if (writeCount >= 50) {
        db?.pragma("wal_checkpoint(PASSIVE)");
        writeCount = 0;
    }
}
