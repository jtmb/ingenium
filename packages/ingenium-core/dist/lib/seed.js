import { getDb, execTransaction, checkpointAfterWrite } from "./db.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
export function seedSkills(projectId, skillsDir) {
    let count = 0;
    execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        if (!existsSync(skillsDir)) {
            logger.warn({ skillsDir }, "Skills directory not found, skipping seed");
            return;
        }
        const entries = readdirSync(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const skillPath = resolve(skillsDir, entry.name, "SKILL.md");
            if (!existsSync(skillPath))
                continue;
            const content = readFileSync(skillPath, "utf-8");
            const nameMatch = content.match(/^name:\s*(.+)$/m);
            const descMatch = content.match(/^description:\s*"(.+)"$/m);
            const name = nameMatch?.[1] ?? entry.name;
            const description = descMatch?.[1] ?? "";
            const now = new Date().toISOString();
            const id = randomUUID();
            db.prepare(`INSERT OR IGNORE INTO skills (id, project_id, name, description, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, name, description, content, now, now);
            count++;
        }
        checkpointAfterWrite();
    });
    logger.info({ count }, "Skills seeded");
    return count;
}
