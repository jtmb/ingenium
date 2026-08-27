import { Router } from "express";
import { coordination, repositoryDocs, repositoryResources, repositorySync } from "ingenium-core";
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

function claimProof(value: unknown): repositorySync.RepositorySyncApplyInput["claim"] | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const proof = value as Record<string, unknown>;
  if (Object.keys(proof).sort().join(",") !== "accepted_epoch,client_claim_key,expected_revision,fence,incarnation,ownership_token,session_id,worktree_id"
    || typeof proof.worktree_id !== "string" || typeof proof.session_id !== "string"
    || !Number.isSafeInteger(proof.incarnation) || !Number.isSafeInteger(proof.expected_revision)
    || !Number.isSafeInteger(proof.fence) || !Number.isSafeInteger(proof.accepted_epoch)
    || typeof proof.ownership_token !== "string" || typeof proof.client_claim_key !== "string") return undefined;
  return {
    worktreeId: proof.worktree_id,
    sessionId: proof.session_id,
    incarnation: proof.incarnation as number,
    expectedRevision: proof.expected_revision as number,
    fence: proof.fence as number,
    ownershipToken: proof.ownership_token,
    clientClaimKey: proof.client_claim_key,
    acceptedEpoch: proof.accepted_epoch as number,
    idempotencyKey: `repository-proof-${proof.expected_revision}`,
  };
}

repositoryRouter.post("/sync", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const body = req.body;
  const proof = body && typeof body === "object" && !Array.isArray(body) ? claimProof(body.claim) : undefined;
  if (!proof || !Number.isSafeInteger(body.expectedGeneration) || body.expectedGeneration < 0
    || typeof body.dryRun !== "boolean" || !("docsManifest" in body)
    || !Object.keys(body).every((key) => ["docsManifest", "resourcesManifest", "dryRun", "expectedGeneration", "claim"].includes(key))) {
    res.status(422).json({ error: { code: "INVALID_REPOSITORY_SYNC", message: "Repository synchronization request is invalid" } });
    return;
  }
  try {
    const result = repositorySync.applyRepositorySync(projectId, {
      docsManifest: body.docsManifest,
      resourcesManifest: body.resourcesManifest,
      dryRun: body.dryRun,
      expectedGeneration: body.expectedGeneration,
      claim: proof,
    });
    res.json({ data: result });
  } catch (error) {
    if (error instanceof coordination.CoordinationError) {
      const status = error.code === "INVALID_COORDINATION_INPUT" ? 422 : 409;
      res.status(status).json({ error: { code: error.code, message: "Repository synchronization claim was rejected" } });
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
      code: "REPOSITORY_SYNC_COORDINATION_REQUIRED",
      message: "Use the coordinated repository synchronization endpoint",
    },
  });
});
