import { Router } from "express";
import { repositoryResources } from "ingenium-core";
import { requireProject } from "../helpers.js";

/**
 * Repository-authoritative non-document resource synchronization.
 *
 * Repository documentation has its own `/docs/repository/sync` endpoint because
 * it owns Docs Workspace hierarchy, tags, and RAG records. This endpoint is
 * deliberately limited to skills, agents, and plugins; it never accepts
 * commands or config, including global config.
 */
export const repositoryRouter = Router();

repositoryRouter.post("/resources/sync", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const body = req.body;
  const validEnvelope = body !== null && typeof body === "object" && !Array.isArray(body)
    && Object.keys(body).every((key) => key === "manifest" || key === "dryRun")
    && Object.prototype.hasOwnProperty.call(body, "manifest")
    && (body.dryRun === undefined || typeof body.dryRun === "boolean");
  if (!validEnvelope) {
    res.status(422).json({ error: { code: "INVALID_REPOSITORY_RESOURCES_MANIFEST", message: "Repository resource manifest is invalid" } });
    return;
  }

  try {
    const result = repositoryResources.syncRepositoryResources(projectId, body.manifest, body.dryRun === true);
    res.json({ data: result });
  } catch (error) {
    // Resource payloads include repository source. Do not reflect parser or
    // storage failures that could expose a source fragment to a caller.
    if (error instanceof repositoryResources.RepositoryResourcesManifestError) {
      res.status(422).json({ error: { code: "INVALID_REPOSITORY_RESOURCES_MANIFEST", message: "Repository resource manifest is invalid" } });
      return;
    }
    res.status(500).json({ error: { code: "REPOSITORY_RESOURCES_SYNC_FAILED", message: "Repository resource synchronization failed" } });
  }
});
