import { createHash } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import * as coordination from "./coordination.js";
import { syncRepositoryDocsInTransaction } from "./repository-docs.js";
import { syncRepositoryResourcesInTransaction } from "./repository-resources.js";

export interface RepositorySyncApplyInput {
  docsManifest: unknown;
  resourcesManifest?: unknown;
  dryRun: boolean;
  expectedGeneration: number;
  claim: coordination.CoordinationClaimProof;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function manifestHash(input: Pick<RepositorySyncApplyInput, "docsManifest" | "resourcesManifest">): string {
  return createHash("sha256").update(stable(input)).digest("hex");
}

export function applyRepositorySync(projectId: string, input: RepositorySyncApplyInput) {
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0) {
    throw new coordination.CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const hash = manifestHash(input);
  const result = execTransaction(() => {
    const proof = coordination.verifyCoordinationClaims(projectId, input.claim, "@repository");
    if (proof.manifestGeneration !== input.expectedGeneration) {
      throw new coordination.CoordinationError("MANIFEST_GENERATION_CONFLICT");
    }
    const docs = syncRepositoryDocsInTransaction(projectId, input.docsManifest, input.dryRun);
    const resources = input.resourcesManifest === undefined
      ? undefined
      : syncRepositoryResourcesInTransaction(projectId, input.resourcesManifest, input.dryRun);
    if (input.dryRun) return { dryRun: true, generation: input.expectedGeneration, manifestHash: hash, docs, resources };

    const updatedAt = new Date().toISOString();
    const changed = getDb().prepare(
      `UPDATE repository_sync_generations SET generation = generation + 1, manifest_hash = ?, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND generation = ?`,
    ).run(hash, updatedAt, projectId, input.claim.worktreeId, input.expectedGeneration);
    if (changed.changes !== 1) throw new coordination.CoordinationError("MANIFEST_GENERATION_CONFLICT");
    return { dryRun: false, generation: input.expectedGeneration + 1, manifestHash: hash, docs, resources };
  });
  if (!input.dryRun) checkpointAfterWrite();
  return result;
}
