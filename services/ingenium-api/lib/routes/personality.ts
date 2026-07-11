import { Router } from "express";
import { personality } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const personalityRouter = Router();

// GET / — list traits
personalityRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const traitType = req.query.trait_type as string | undefined;
  const list = personality.getTraits(projectId, traitType as any);
  res.json({ data: list, total: list.length });
});

// GET /profile — aggregated profile
personalityRouter.get("/profile", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const profile = personality.getProfile(projectId);
  res.json({ data: profile });
});

// POST / — upsert a trait
personalityRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { trait_type, trait_value, display_label, confidence, exemplar_observation_id, exemplar_text } = req.body;
  if (!trait_type || !trait_value) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "trait_type and trait_value are required" } });
    return;
  }
  const trait = personality.upsertTrait(projectId, trait_type, trait_value, display_label, confidence, exemplar_observation_id, exemplar_text);
  res.status(201).json({ data: trait });
});

// POST /:id/dismiss
personalityRouter.post("/:id/dismiss", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid trait ID" } });
    return;
  }
  personality.setActive(projectId, id, false);
  res.json({ data: { id } });
});

// POST /:id/disable
personalityRouter.post("/:id/disable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: "INVALID_ID", message: "Trait ID must be a number" } });
    return;
  }
  personality.disableTrait(id);
  res.status(204).send();
});

// DELETE /:id — hard delete a single personality trait
personalityRouter.delete("/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: "INVALID_ID", message: "Trait ID must be a number" } });
    return;
  }
  const deleted = personality.deleteTrait(projectId, id);
  if (!deleted) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Trait not found" } });
    return;
  }
  res.status(204).send();
});

// DELETE / — hard delete ALL personality traits for the project
personalityRouter.delete("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const count = personality.deleteAllTraits(projectId);
  res.json({ data: { deleted: count } });
});
