import { createHash } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { syncRepositoryDocsInTransaction } from "./repository-docs.js";
import { syncRepositoryResourcesInTransaction } from "./repository-resources.js";

export type RepositorySyncErrorCode = "INVALID_REPOSITORY_SYNC" | "MANIFEST_GENERATION_CONFLICT";

export class RepositorySyncError extends Error {
  constructor(readonly code: RepositorySyncErrorCode, readonly currentGeneration?: number) {
    super(code);
    this.name = "RepositorySyncError";
  }
}

export interface RepositorySyncApplyInput {
  docsManifest: unknown;
  resourcesManifest?: unknown;
  dryRun: boolean;
  expectedGeneration: number;
  worktreeId: string;
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
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0
    || !/^worktree-[a-f0-9]{64}$/.test(input.worktreeId)) {
    throw new RepositorySyncError("INVALID_REPOSITORY_SYNC");
  }
  const hash = manifestHash(input);
  const result = execTransaction(() => {
    const db = getDb();
    const updatedAt = new Date().toISOString();
    if (!input.dryRun) {
      db.prepare(
        `INSERT INTO coordination_worktrees (project_id, worktree_id, next_fence, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?) ON CONFLICT(project_id, worktree_id) DO NOTHING`,
      ).run(projectId, input.worktreeId, updatedAt, updatedAt);
      const worktreeExists = db.prepare(
        "SELECT 1 FROM coordination_worktrees WHERE project_id = ? AND worktree_id = ?",
      ).get(projectId, input.worktreeId);
      if (!worktreeExists) throw new RepositorySyncError("INVALID_REPOSITORY_SYNC");
      db.prepare(
        `INSERT INTO repository_sync_generations (project_id, worktree_id, generation, manifest_hash, updated_at)
         VALUES (?, ?, 0, NULL, ?) ON CONFLICT(project_id, worktree_id) DO NOTHING`,
      ).run(projectId, input.worktreeId, updatedAt);
    }
    const generation = (db.prepare(
      "SELECT generation FROM repository_sync_generations WHERE project_id = ? AND worktree_id = ?",
    ).get(projectId, input.worktreeId) as { generation: number } | undefined)?.generation ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new RepositorySyncError("INVALID_REPOSITORY_SYNC");
    }
    if (generation !== input.expectedGeneration) {
      throw new RepositorySyncError("MANIFEST_GENERATION_CONFLICT", generation);
    }
    const docs = syncRepositoryDocsInTransaction(projectId, input.docsManifest, input.dryRun);
    const resources = input.resourcesManifest === undefined
      ? undefined
      : syncRepositoryResourcesInTransaction(projectId, input.resourcesManifest, input.dryRun);
    if (input.dryRun) return { dryRun: true, generation: input.expectedGeneration, manifestHash: hash, docs, resources };

    const changed = db.prepare(
      `UPDATE repository_sync_generations SET generation = generation + 1, manifest_hash = ?, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND generation = ?`,
    ).run(hash, updatedAt, projectId, input.worktreeId, input.expectedGeneration);
    if (changed.changes !== 1) {
      const current = (db.prepare(
        "SELECT generation FROM repository_sync_generations WHERE project_id = ? AND worktree_id = ?",
      ).get(projectId, input.worktreeId) as { generation: number } | undefined)?.generation;
      throw new RepositorySyncError(
        "MANIFEST_GENERATION_CONFLICT",
        Number.isSafeInteger(current) && current! >= 0 ? current : undefined,
      );
    }
    return { dryRun: false, generation: input.expectedGeneration + 1, manifestHash: hash, docs, resources };
  });
  if (!input.dryRun) checkpointAfterWrite();
  return result;
}
