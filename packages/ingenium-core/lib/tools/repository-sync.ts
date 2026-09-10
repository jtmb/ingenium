import { createHash } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  MAX_REPOSITORY_DOC_FILES,
  MAX_REPOSITORY_DOC_FILE_BYTES,
  MAX_REPOSITORY_DOC_TOTAL_BYTES,
  syncRepositoryDocsInTransaction,
} from "./repository-docs.js";
import {
  MAX_REPOSITORY_RESOURCE_FILE_BYTES,
  MAX_REPOSITORY_RESOURCE_ITEMS,
  MAX_REPOSITORY_RESOURCE_TOTAL_BYTES,
  syncRepositoryResourcesInTransaction,
} from "./repository-resources.js";

export type RepositorySyncErrorCode = "INVALID_REPOSITORY_SYNC" | "MANIFEST_GENERATION_CONFLICT" | "REPOSITORY_SYNC_STRUCTURE_LIMIT";

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

const MAX_REPOSITORY_SYNC_DEPTH = 16;
const MAX_REPOSITORY_SYNC_CONTAINER_ENTRIES = Math.max(MAX_REPOSITORY_DOC_FILES, MAX_REPOSITORY_RESOURCE_ITEMS);
const MAX_REPOSITORY_SYNC_NODES = (MAX_REPOSITORY_DOC_FILES + MAX_REPOSITORY_RESOURCE_ITEMS) * 256;
const MAX_REPOSITORY_SYNC_CANONICAL_BYTES = 4 * 1024 * 1024;
const MAX_REPOSITORY_RESOURCE_ENVELOPE_BYTES = MAX_REPOSITORY_RESOURCE_TOTAL_BYTES + MAX_REPOSITORY_RESOURCE_ITEMS + 256;
const RESOURCE_TEXT_FIELDS = new Set(["body", "category", "description", "fileTreeContent", "frontmatter", "mode", "skillMd", "source"]);
const RESOURCE_RECORD_FIELDS = new Set(["metadata", "options", "permissions"]);
const BOUNDED_STRING_ARRAY_FIELDS = new Set(["mirrors", "skills", "tags"]);

function structuralLimit(): never {
  throw new RepositorySyncError("REPOSITORY_SYNC_STRUCTURE_LIMIT");
}

function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) bytes += 2;
    else if (code <= 0x1f) bytes += 6;
    else if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}

function measureStructure(
  value: unknown,
  depth: number,
  parentKey: string | undefined,
  state: { nodes: number; seen: WeakSet<object> },
  documentation = false,
): number {
  state.nodes += 1;
  if (state.nodes > MAX_REPOSITORY_SYNC_NODES || depth > MAX_REPOSITORY_SYNC_DEPTH) structuralLimit();
  if (value === null) return 4;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value);
    if (parentKey === "path" || BOUNDED_STRING_ARRAY_FIELDS.has(parentKey ?? "")) {
      if (value.length > 512) structuralLimit();
    } else {
      const limit = RESOURCE_TEXT_FIELDS.has(parentKey ?? "")
        ? MAX_REPOSITORY_RESOURCE_FILE_BYTES
        : documentation && parentKey === "content" ? MAX_REPOSITORY_DOC_FILE_BYTES : 512 * 1024;
      if (bytes > limit) structuralLimit();
    }
    return jsonStringBytes(value);
  }
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) structuralLimit();
    return String(value).length;
  }
  if (typeof value !== "object") structuralLimit();
  if (state.seen.has(value)) structuralLimit();
  state.seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > MAX_REPOSITORY_SYNC_CONTAINER_ENTRIES) structuralLimit();
    let bytes = 2 + Math.max(0, value.length - 1);
    for (let index = 0; index < value.length; index += 1) {
      bytes += measureStructure(value[index], depth + 1, parentKey, state, documentation);
      if (bytes > MAX_REPOSITORY_SYNC_CANONICAL_BYTES) structuralLimit();
    }
    return bytes;
  }

  let entries = 0;
  let bytes = 2;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    entries += 1;
    if (entries > MAX_REPOSITORY_SYNC_CONTAINER_ENTRIES || key.length > 512) structuralLimit();
    if (entries > 1) bytes += 1;
    const childKey = parentKey === "fileTree" ? "fileTreeContent" : key;
    bytes += jsonStringBytes(key) + 1
      + measureStructure((value as Record<string, unknown>)[key], depth + 1, childKey, state, documentation);
    if (bytes > MAX_REPOSITORY_SYNC_CANONICAL_BYTES) structuralLimit();
  }
  if (RESOURCE_RECORD_FIELDS.has(parentKey ?? "") && bytes > MAX_REPOSITORY_RESOURCE_FILE_BYTES) structuralLimit();
  return bytes;
}

export function assertRepositorySyncStructure(
  input: Pick<RepositorySyncApplyInput, "docsManifest" | "resourcesManifest">,
): void {
  if (input.docsManifest !== null && typeof input.docsManifest === "object" && !Array.isArray(input.docsManifest)) {
    const files = (input.docsManifest as Record<string, unknown>).files;
    if (Array.isArray(files)) {
      if (files.length > MAX_REPOSITORY_DOC_FILES) structuralLimit();
      let contentBytes = 0;
      for (const file of files) {
        if (file === null || typeof file !== "object" || Array.isArray(file)) continue;
        const content = (file as Record<string, unknown>).content;
        if (typeof content !== "string") continue;
        const bytes = Buffer.byteLength(content);
        if (bytes > MAX_REPOSITORY_DOC_FILE_BYTES) structuralLimit();
        contentBytes += bytes;
        if (contentBytes > MAX_REPOSITORY_DOC_TOTAL_BYTES) structuralLimit();
      }
    }
  }

  if (input.resourcesManifest !== null && typeof input.resourcesManifest === "object" && !Array.isArray(input.resourcesManifest)) {
    const resources = input.resourcesManifest as Record<string, unknown>;
    const lists = [resources.skills, resources.agents, resources.plugins];
    let entries = 0;
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      entries += list.length;
      if (entries > MAX_REPOSITORY_RESOURCE_ITEMS) structuralLimit();
    }
  }

  const state = { nodes: 0, seen: new WeakSet<object>() };
  let bytes = 2 + jsonStringBytes("docsManifest") + 1
    + measureStructure(input.docsManifest, 0, "docsManifest", state, true);
  if (input.resourcesManifest !== undefined) {
    const resourceBytes = measureStructure(input.resourcesManifest, 0, "resourcesManifest", state);
    if (resourceBytes > MAX_REPOSITORY_RESOURCE_ENVELOPE_BYTES) structuralLimit();
    bytes += 1 + jsonStringBytes("resourcesManifest") + 1 + resourceBytes;
  }
  if (bytes > MAX_REPOSITORY_SYNC_CANONICAL_BYTES) structuralLimit();
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
  assertRepositorySyncStructure(input);
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
