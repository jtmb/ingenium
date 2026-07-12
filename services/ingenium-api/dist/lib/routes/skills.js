import { Router } from "express";
import { skills, synthesis } from "ingenium-core";
import { requireProject } from "../helpers.js";
import fs from "fs";
import path from "path";
export const skillsRouter = Router();
skillsRouter.get("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const list = skills.listSkills(projectId);
    res.json({ data: list, total: list.length });
});
skillsRouter.get("/search", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const query = req.query.q;
    if (!query) {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
        return;
    }
    const results = skills.searchSkills(projectId, query);
    res.json({ data: results, total: results.length });
});
skillsRouter.get("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const skill = skills.getSkill(projectId, req.params.name);
    if (!skill) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
        return;
    }
    res.json({ data: skill });
});
skillsRouter.post("/", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { name, description, content, category, tags, always_apply, files } = req.body;
    const skill = skills.createSkill(projectId, name, description, content, category, tags, always_apply, files);
    res.status(201).json({ data: skill });
});
skillsRouter.patch("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const { content, description, tags, always_apply, files } = req.body;
    const updated = skills.updateSkill(projectId, req.params.name, content, description, tags, always_apply, files);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
        return;
    }
    res.json({ data: updated });
});
skillsRouter.delete("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const deleted = skills.deleteSkill(projectId, req.params.name);
    if (!deleted) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
        return;
    }
    res.status(204).send();
});
skillsRouter.post("/:name/enable", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const skill = skills.enableSkill(projectId, req.params.name);
    if (!skill) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
        return;
    }
    res.json({ data: skill });
});
skillsRouter.post("/:name/disable", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const skill = skills.disableSkill(projectId, req.params.name);
    if (!skill) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
        return;
    }
    res.json({ data: skill });
});
skillsRouter.post("/:name/sync", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const skill = skills.syncSkillFromDisk(projectId, req.params.name);
    if (!skill) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found on disk` } });
        return;
    }
    res.json({ data: skill });
});
// POST /sync-all — sync ALL skills disk→DB then DB→disk for a project
skillsRouter.post("/sync-all", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const skillsDir = path.resolve(process.env.INGENIUM_CORE_DB_PATH ?? "/app/.ingenium/data", "..", "..", ".opencode", "skills");
    let fromDisk = 0;
    let toDisk = 0;
    let errors = [];
    // Phase 1: Disk → DB — scan directories on disk, sync any not in DB
    try {
        if (fs.existsSync(skillsDir)) {
            const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const e of entries) {
                if (e.isDirectory()) {
                    const skillMdPath = path.join(skillsDir, e.name, "SKILL.md");
                    if (!fs.existsSync(skillMdPath))
                        continue;
                    try {
                        const existing = skills.getSkill(projectId, e.name);
                        if (!existing) {
                            const synced = skills.syncSkillFromDisk(projectId, e.name);
                            if (synced)
                                fromDisk++;
                            else
                                errors.push(`Disk sync failed: ${e.name}`);
                        }
                    }
                    catch (err) {
                        errors.push(`Disk sync error: ${e.name} — ${err.message}`);
                    }
                }
            }
        }
    }
    catch (err) {
        errors.push(`Failed to scan skills dir: ${err.message}`);
    }
    // Phase 2: DB → Disk — write all DB skills to disk
    try {
        toDisk = skills.syncAllSkills(projectId);
    }
    catch (err) {
        errors.push(`Failed to write skills to disk: ${err.message}`);
    }
    res.json({ data: { synced_to_db: fromDisk, written_to_disk: toDisk, errors } });
});
// POST /consolidate — LLM-driven skill audit to merge redundant skills, targeting ≤20
skillsRouter.post("/consolidate", async (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    try {
        const result = await synthesis.consolidateSkills(projectId);
        res.json({ data: result });
    }
    catch (err) {
        res.status(500).json({ error: { code: "CONSOLIDATION_ERROR", message: err.message } });
    }
});
