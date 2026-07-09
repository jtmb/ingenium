import { Router } from "express";
import { skills } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const skillsRouter = Router();

skillsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const list = skills.listSkills(projectId);
  res.json({ data: list, total: list.length });
});

skillsRouter.get("/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const query = req.query.q as string;
  if (!query) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
    return;
  }
  const results = skills.searchSkills(projectId, query);
  res.json({ data: results, total: results.length });
});

skillsRouter.get("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const skill = skills.getSkill(projectId, req.params.name!);
  if (!skill) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
    return;
  }
  res.json({ data: skill });
});

skillsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { name, description, content, category, tags, always_apply } = req.body;
  const skill = skills.createSkill(projectId, name, description, content, category, tags, always_apply);
  res.status(201).json({ data: skill });
});

skillsRouter.patch("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { content, description, tags, always_apply } = req.body;
  const updated = skills.updateSkill(projectId, req.params.name!, content, description, tags, always_apply);
  if (!updated) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } });
    return;
  }
  res.json({ data: updated });
});

skillsRouter.delete("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const deleted = skills.deleteSkill(projectId, req.params.name);
  if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } }); return; }
  res.status(204).send();
});

skillsRouter.post("/:name/enable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const skill = skills.enableSkill(projectId, req.params.name);
  if (!skill) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } }); return; }
  res.json({ data: skill });
});

skillsRouter.post("/:name/disable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const skill = skills.disableSkill(projectId, req.params.name);
  if (!skill) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found` } }); return; }
  res.json({ data: skill });
});

skillsRouter.post("/:name/sync", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const skill = skills.syncSkillFromDisk(projectId, req.params.name);
  if (!skill) { res.status(404).json({ error: { code: "NOT_FOUND", message: `Skill '${req.params.name}' not found on disk` } }); return; }
  res.json({ data: skill });
});
