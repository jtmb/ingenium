import { Router } from "express";
import { skills } from "ingenium-core";
import { requireProject } from "../helpers.js";
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
    const { name, description, content, category } = req.body;
    const skill = skills.createSkill(projectId, name, description, content, category);
    res.status(201).json({ data: skill });
});
skillsRouter.patch("/:name", (req, res) => {
    const projectId = requireProject(req, res);
    if (!projectId)
        return;
    const updated = skills.updateSkill(projectId, req.params.name, req.body.content);
    if (!updated) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
        return;
    }
    res.json({ data: updated });
});
