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

projectsRouter.delete("/:name", (req, res) => {
  const deleted = projects.deleteProject(req.params.name!);
  if (!deleted) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Project '${req.params.name}' not found` } });
    return;
  }
  res.status(204).send();
});
