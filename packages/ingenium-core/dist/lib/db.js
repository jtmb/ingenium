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
        for (const file of ["001_init.sql", "002_archive.sql", "003_agents.sql", "004_learnings_status.sql", "005_skills_metadata.sql", "006_skill_file_tree.sql", "007_observations.sql", "008_personality_traits.sql", "009_pipeline_events.sql", "010_commands.sql", "011_server_source.sql", "012_project_is_global.sql", "013_fix_plugins_unique.sql", "014_configs.sql", "016_mcp_tool_states.sql", "017_fix_trait_fk.sql"]) {
            const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
            db.exec(sql);
            logger.info("db", `Applied migration ${file}`);
        }
    }
    else {
        // Check if archived_at column exists (migration 002)
        const colCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('projects') WHERE name = 'archived_at'").get();
        if (colCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "002_archive.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 002_archive.sql");
        }
        // Check if agents table exists (migration 003)
        const agentsCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='agents'").get();
        if (agentsCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "003_agents.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 003_agents.sql");
        }
        // Check if status column exists on learnings (migration 004)
        const statusColCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('learnings') WHERE name = 'status'").get();
        if (statusColCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "004_learnings_status.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 004_learnings_status.sql");
        }
        // Check if tags column exists on skills (migration 005)
        const tagsColCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('skills') WHERE name = 'tags'").get();
        if (tagsColCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "005_skills_metadata.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 005_skills_metadata.sql");
        }
        // Check if file_tree column exists on skills (migration 006)
        const fileTreeCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('skills') WHERE name = 'file_tree'").get();
        if (fileTreeCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "006_skill_file_tree.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 006_skill_file_tree.sql");
        }
        // Check if observations table exists (migration 007)
        const observationsCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='observations'").get();
        if (observationsCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "007_observations.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 007_observations.sql");
        }
        // Check if personality_traits table exists (migration 008)
        const personalityCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='personality_traits'").get();
        if (personalityCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "008_personality_traits.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 008_personality_traits.sql");
        }
        // Check if pipeline_events table exists (migration 009)
        const pipelineEventsCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='pipeline_events'").get();
        if (pipelineEventsCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "009_pipeline_events.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 009_pipeline_events.sql");
        }
        // Check if commands table exists (migration 010)
        const commandsCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='commands'").get();
        if (commandsCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "010_commands.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 010_commands.sql");
        }
        // Check if source column exists on servers (migration 011)
        const sourceColCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('servers') WHERE name = 'source'").get();
        if (sourceColCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "011_server_source.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 011_server_source.sql");
        }
        // Check if is_global column exists on projects (migration 012)
        const isGlobalColCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('projects') WHERE name = 'is_global'").get();
        if (isGlobalColCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "012_project_is_global.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 012_project_is_global.sql");
        }
        // Check if plugins table still uses UNIQUE(name) instead of UNIQUE(project_id, name) (migration 013)
        const pluginsCreateSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='plugins'").get();
        if (pluginsCreateSql && !pluginsCreateSql.sql.includes("UNIQUE(project_id, name)")) {
            const sql = readFileSync(resolve(migrationsDir, "013_fix_plugins_unique.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 013_fix_plugins_unique.sql");
        }
        // Check if configs table exists (migration 014)
        const configsCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='configs'").get();
        if (configsCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "014_configs.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 014_configs.sql");
        }
        // Check if observations source CHECK includes 'auto-observer' (migration 015)
        let observationsCreateSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='observations'").get();
        if (observationsCreateSql && !observationsCreateSql.sql.includes("auto-observer")) {
            const sql = readFileSync(resolve(migrationsDir, "015_auto_observer_source.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 015_auto_observer_source.sql");
            // Re-read observations CREATE SQL — migration 015 just rebuilt the table
            observationsCreateSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='observations'").get();
        }
        // Check if mcp_tool_states table exists (migration 016)
        const mcpToolStatesCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='mcp_tool_states'").get();
        if (mcpToolStatesCheck.count === 0) {
            const sql = readFileSync(resolve(migrationsDir, "016_mcp_tool_states.sql"), "utf-8");
            db.exec(sql);
            logger.info("db", "Applied migration 016_mcp_tool_states.sql");
        }
        // Check if personality_traits FK needs rebuilding (migration 017)
        // After migration 015 renamed/recreated observations, the FK in personality_traits
        // may reference a stale internal table reference. Detect by checking if the
        // personality_traits CREATE TABLE SQL includes the 017_rebuilt marker comment.
        const traitsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='personality_traits'").get();
        if (traitsSql && observationsCreateSql && observationsCreateSql.sql.includes("auto-observer") && !traitsSql.sql.includes("017_rebuilt")) {
            const sql = readFileSync(resolve(migrationsDir, "017_fix_trait_fk.sql"), "utf-8");
            // Disable FK enforcement during migration to avoid cascading FTS trigger errors
            db.pragma("foreign_keys = OFF");
            db.exec(sql);
            db.pragma("foreign_keys = ON");
            logger.info("db", "Applied migration 017_fix_trait_fk.sql");
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
                logger.warn("db", "DB contention, retrying", { attempt, delay });
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
