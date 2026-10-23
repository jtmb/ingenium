import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { Request } from "express";
import { Router } from "express";
import { repositoryDocs, repositoryResources, repositorySync } from "ingenium-core";
import { requireProject } from "../helpers.js";

/**
 * Repository-authoritative non-document resource synchronization.
 *
 * Repository documentation has its own `/docs/repository/sync` endpoint because
 * it owns Docs Workspace hierarchy, tags, and RAG records. This endpoint is
 * projects skills, agents, plugins, and commands; it never accepts config,
 * including global config.
 */
export const repositoryRouter = Router();

function boundRepositoryWorktreeId(req: Request, projectId: string): string | null {
  const principal = req.principal;
  if (principal?.type !== "service" || principal.audience !== "repository-sync"
    || principal.projectId !== projectId || !principal.projectIds?.includes(projectId)
    || !principal.organizationId || !principal.scopes.includes("repository:sync")
    || typeof principal.workspaceId !== "string" || principal.workspaceId.length === 0 || principal.workspaceId.length > 256
    || /[\u0000-\u001f\u007f]/.test(principal.workspaceId)
    || typeof principal.launcherWorktree !== "string" || principal.launcherWorktree.length === 0
    || principal.launcherWorktree.length > 1024 || !isAbsolute(principal.launcherWorktree)
    || /[\u0000-\u001f\u007f]/.test(principal.launcherWorktree)
    || typeof principal.storageMappingHash !== "string" || !/^[a-f0-9]{64}$/.test(principal.storageMappingHash)) {
    return null;
  }
  return `worktree-${createHash("sha256")
    .update(principal.workspaceId)
    .update("\0")
    .update(principal.storageMappingHash)
    .digest("hex")}`;
}

repositoryRouter.post("/sync", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const body = req.body;
  const worktreeId = boundRepositoryWorktreeId(req, projectId);
  if (!worktreeId) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || !Number.isSafeInteger(body.expectedGeneration) || body.expectedGeneration < 0
    || typeof body.dryRun !== "boolean" || !("docsManifest" in body)
    || !Object.keys(body).every((key) => ["docsManifest", "resourcesManifest", "dryRun", "expectedGeneration"].includes(key))) {
    res.status(422).json({ error: { code: "INVALID_REPOSITORY_SYNC", message: "Repository synchronization request is invalid" } });
    return;
  }
  try {
    const result = repositorySync.applyRepositorySync(projectId, {
      docsManifest: body.docsManifest,
      resourcesManifest: body.resourcesManifest,
      dryRun: body.dryRun,
      expectedGeneration: body.expectedGeneration,
      worktreeId,
    });
    res.json({ data: result });
  } catch (error) {
    if (error instanceof repositorySync.RepositorySyncError) {
      if (error.code === "REPOSITORY_SYNC_STRUCTURE_LIMIT") {
        res.status(400).json({ error: { code: "INVALID_REPOSITORY_SYNC", message: "Repository synchronization request is invalid" } });
        return;
      }
      if (error.code === "MANIFEST_GENERATION_CONFLICT") {
        res.status(409).json({ error: {
          code: error.code,
          message: "Repository manifest generation changed",
          ...(Number.isSafeInteger(error.currentGeneration) && error.currentGeneration! >= 0
            ? { currentGeneration: error.currentGeneration }
            : {}),
        } });
        return;
      }
      res.status(422).json({ error: { code: error.code, message: "Repository synchronization request is invalid" } });
      return;
    }
    if (error instanceof repositoryResources.RepositoryResourcesManifestError
      || error instanceof repositoryDocs.RepositoryDocsManifestError) {
      res.status(422).json({ error: { code: "INVALID_REPOSITORY_SYNC", message: "Repository synchronization request is invalid" } });
      return;
    }
    res.status(500).json({ error: { code: "REPOSITORY_SYNC_FAILED", message: "Repository synchronization failed" } });
  }
});

repositoryRouter.post("/resources/sync", (_req, res) => {
  res.status(409).json({
    error: {
      code: "REPOSITORY_SYNC_ENDPOINT_REQUIRED",
      message: "Use the repository synchronization endpoint",
    },
  });
});
