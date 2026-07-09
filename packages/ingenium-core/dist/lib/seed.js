import { getDb, execTransaction, checkpointAfterWrite } from "./db.js";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { syncAllAgents } from "./tools/agents.js";
import { syncAllSkills } from "./tools/skills.js";
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
            // Read metadata.json if it exists
            const metaPath = resolve(skillsDir, entry.name, "metadata.json");
            let metaTags = "";
            let metaAlwaysApply = 0;
            if (existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
                    if (Array.isArray(meta.tags))
                        metaTags = meta.tags.join(",");
                    if (meta.alwaysApply === true)
                        metaAlwaysApply = 1;
                }
                catch { }
            }
            const name = nameMatch?.[1] ?? entry.name;
            const description = descMatch?.[1] ?? "";
            const now = new Date().toISOString();
            const id = randomUUID();
            const result = db.prepare(`INSERT OR IGNORE INTO skills (id, project_id, name, description, content, tags, always_apply, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, name, description, content, metaTags, metaAlwaysApply, now, now);
            // Sync FTS5 index if this was a new insert (not ignored)
            if (result.changes > 0) {
                db.prepare("INSERT OR IGNORE INTO skills_fts(rowid, content, description) VALUES (?, ?, ?)")
                    .run(result.lastInsertRowid, content, description);
            }
            // Write SKILL.md to disk for OpenCode auto-discovery
            const outDir = resolve(resolve(skillsDir, "..", ".."), ".opencode", "skills", name);
            if (!existsSync(outDir))
                mkdirSync(outDir, { recursive: true });
            writeFileSync(resolve(outDir, "SKILL.md"), content);
            count++;
        }
        checkpointAfterWrite();
    });
    // Sync all DB skills to disk — restores skill files even if .agents/skills/ was deleted
    try {
        const synced = syncAllSkills(projectId);
        count = synced;
    }
    catch { }
    logger.info({ count }, "Skills seeded");
    return count;
}
export function seedPlugins(projectId, pluginsDir) {
    let count = 0;
    execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        if (!existsSync(pluginsDir)) {
            logger.warn({ pluginsDir }, "Plugins directory not found, skipping seed");
            return;
        }
        // Compute project root and plugin output directory
        const projectRoot = resolve(pluginsDir, "..", "..");
        const outDir = resolve(projectRoot, ".opencode", "plugins");
        if (!existsSync(outDir))
            mkdirSync(outDir, { recursive: true });
        const entries = readdirSync(pluginsDir, { withFileTypes: true });
        const pluginPaths = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".ts"))
                continue;
            const filePath = resolve(pluginsDir, entry.name);
            const sourceContent = readFileSync(filePath, "utf-8");
            const name = entry.name.replace(/\.ts$/, "");
            const now = new Date().toISOString();
            const id = randomUUID();
            db.prepare(`INSERT OR IGNORE INTO plugins (id, project_id, name, file_path, enabled, source_content, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).run(id, projectId, name, entry.name, sourceContent, now, now);
            // Write plugin file to .opencode/plugins/
            writeFileSync(resolve(outDir, entry.name), sourceContent);
            pluginPaths.push(`.opencode/plugins/${entry.name}`);
            count++;
        }
        checkpointAfterWrite();
        // Sync opencode.json plugin array
        try {
            const configPath = resolve(projectRoot, "opencode.json");
            if (existsSync(configPath)) {
                const config = JSON.parse(readFileSync(configPath, "utf-8"));
                config.plugin = pluginPaths;
                writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
            }
        }
        catch { /* opencode.json may not exist */ }
    });
    logger.info({ count }, "Plugins seeded");
    return count;
}
export function seedAgents(projectId, agentsDir) {
    let count = 0;
    execTransaction(() => {
        const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
        if (!existsSync(agentsDir)) {
            logger.warn({ agentsDir }, "Agents directory not found, skipping seed");
            return;
        }
        const categoryDirs = readdirSync(agentsDir, { withFileTypes: true });
        for (const catEntry of categoryDirs) {
            if (!catEntry.isDirectory())
                continue;
            const category = catEntry.name;
            const catPath = resolve(agentsDir, category);
            const files = readdirSync(catPath, { withFileTypes: true });
            for (const file of files) {
                if (!file.isFile() || !file.name.endsWith(".md"))
                    continue;
                const filePath = resolve(catPath, file.name);
                const content = readFileSync(filePath, "utf-8");
                const name = file.name.replace(/\.md$/, "");
                // Parse YAML frontmatter
                const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
                if (!fmMatch)
                    continue;
                const frontmatter = fmMatch[1];
                const body = fmMatch[2].trim();
                const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
                const descMatch = frontmatter.match(/^description:\s*"(.+)"$/m);
                const modeMatch = frontmatter.match(/^mode:\s*(.+)$/m);
                const modelMatch = frontmatter.match(/^model:\s*(.+)$/m);
                const reasoningMatch = frontmatter.match(/^reasoning_effort:\s*"(.+)"$/m);
                // Parse permission block
                const readPerm = frontmatter.match(/^  read:\s*(.+)$/m)?.[1] ?? "allow";
                const writePerm = frontmatter.match(/^  write:\s*(.+)$/m)?.[1] ?? "allow";
                const bashPerm = frontmatter.match(/^  bash:\s*(.+)$/m)?.[1] ?? "allow";
                // Parse skills list
                const skillMatches = [...frontmatter.matchAll(/^\s+-\s(.+)$/gm)].map(m => m[1]);
                // Parse nested task: permission block
                const taskPerms = {};
                const taskMatch = frontmatter.match(/^  task:\n((?:(?:    .+\n)|(?:\s*#.+\n))*)/m);
                if (taskMatch) {
                    const taskLines = taskMatch[1].split('\n').filter(l => !l.trimStart().startsWith('#') && l.trim());
                    for (const line of taskLines) {
                        const kv = line.match(/^\s{4,}"(.+?)":\s*"(.+?)"/);
                        if (kv)
                            taskPerms[kv[1]] = kv[2];
                    }
                }
                // Parse nested mcp: permission block
                const mcpPerms = {};
                const mcpMatch = frontmatter.match(/^  mcp:\n((?:(?:    .+\n)|(?:\s*#.+\n))*)/m);
                if (mcpMatch) {
                    const mcpLines = mcpMatch[1].split('\n').filter(l => !l.trimStart().startsWith('#') && l.trim());
                    for (const line of mcpLines) {
                        const kv = line.match(/^\s{4,}"(.+?)":\s*"(.+?)"/);
                        if (kv)
                            mcpPerms[kv[1]] = kv[2];
                    }
                }
                // Parse nested skill: permission block
                const skillPerms = {};
                const skillMatch = frontmatter.match(/^  skill:\n((?:(?:    .+\n)|(?:\s*#.+\n))*)/m);
                if (skillMatch) {
                    const skillLines = skillMatch[1].split('\n').filter(l => !l.trimStart().startsWith('#') && l.trim());
                    for (const line of skillLines) {
                        const kv = line.match(/^\s{4,}"(.+?)":\s*"(.+?)"/);
                        if (kv)
                            skillPerms[kv[1]] = kv[2];
                    }
                }
                const agentName = nameMatch?.[1] ?? name;
                const description = descMatch?.[1] ?? "";
                const mode = modeMatch?.[1] ?? "subagent";
                const model = modelMatch?.[1] ?? null;
                const reasoningEffort = reasoningMatch?.[1] ?? null;
                const permObj = { read: readPerm, write: writePerm, bash: bashPerm };
                if (Object.keys(taskPerms).length > 0)
                    permObj.task = taskPerms;
                if (Object.keys(mcpPerms).length > 0)
                    permObj.mcp = mcpPerms;
                if (Object.keys(skillPerms).length > 0)
                    permObj.skill = skillPerms;
                const permissions = JSON.stringify(permObj);
                const now = new Date().toISOString();
                const id = randomUUID();
                db.prepare(`INSERT OR IGNORE INTO agents (id, project_id, name, description, category, mode, model, reasoning_effort, permissions, skills, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, agentName, description, category, mode, model, reasoningEffort, permissions, JSON.stringify(skillMatches), body, now, now);
                count++;
            }
        }
        checkpointAfterWrite();
    });
    // Sync all DB agents to disk — restores agent files even if .opencode/ was deleted
    try {
        const synced = syncAllAgents(projectId);
        count = synced;
    }
    catch { }
    logger.info({ count }, "Agents seeded");
    return count;
}
