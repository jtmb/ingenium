import { Router } from "express";
import { projects } from "ingenium-core";
export const projectsRouter = Router();
projectsRouter.get("/", (_req, res) => {
    const list = projects.listProjects();
    res.json({ data: list });
});
projectsRouter.post("/", (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
        return;
    }
    const project = projects.createProject(name);
    res.status(201).json({ data: project });
});
projectsRouter.patch("/:name", (req, res) => {
    const { name: newName } = req.body;
    if (!newName || typeof newName !== "string") {
        res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "name is required in body" } });
        return;
    }
    const updated = projects.updateProject(req.params.name, newName);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Project '${req.params.name}' not found` } });
        return;
    }
    res.json({ data: updated });
});
projectsRouter.get("/archive", (_req, res) => {
    const list = projects.listArchivedProjects();
    res.json({ data: list });
});
projectsRouter.delete("/:name", (req, res) => {
    const archived = projects.archiveProject(req.params.name);
    if (!archived) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Project '${req.params.name}' not found or already archived` } });
        return;
    }
    res.status(200).json({ data: { archived: true } });
});
projectsRouter.post("/:name/restore", (req, res) => {
    const restored = projects.unarchiveProject(req.params.name);
    if (!restored) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Archived project '${req.params.name}' not found` } });
        return;
    }
    res.json({ data: { restored: true } });
});
projectsRouter.post("/purge", (req, res) => {
    const retentionDays = req.body.retention_days ?? 7;
    const purged = projects.purgeExpiredProjects(retentionDays);
    res.json({ data: { purged_count: purged } });
});
