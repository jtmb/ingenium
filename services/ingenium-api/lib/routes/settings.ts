import { Router } from "express";
import { settings } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const settingsRouter = Router();

settingsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const key = req.query.key as string;
  if (!key) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key query parameter is required" } });
    return;
  }
  const value = settings.getSetting(projectId, key);
  res.json({ data: { key, value } });
});

settingsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { key, value } = req.body;
  if (!key || typeof value !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key and value are required" } });
    return;
  }
  settings.setSetting(projectId, key, value);
  res.json({ data: { key, value } });
});
