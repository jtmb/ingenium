import { createHash, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb, sanitizeFts5Query } from "../db.js";
import { estimateTokens } from "./rag-chunker.js";
import { hasLikelyContextSourceSecret } from "./context-rag.js";

export const EXPLICIT_MEMORY_MAX_ITEMS = 16;
export const EXPLICIT_MEMORY_MAX_TOKENS = 2_048;

export type ExplicitMemoryVisibility = "private" | "project";
export type ExplicitMemoryOperation = "save" | "update" | "forget";
export type ExplicitMemoryOrigin = "explicit" | "context_archive" | "source";

export interface ExplicitMemoryScope {
  organizationId: string;
  projectId: string;
  workspaceId: string;
  ownerUserId: string;
  allowProjectVisibility: boolean;
}

export type ExplicitMemoryPrincipal =
  | { type: "user"; userId: string }
  | {
      type: "service";
      servicePrincipalId: string;
      credentialId: string;
      storageMappingHash: string;
    };

export interface ExplicitMemory {
  id: string;
  organizationId: string;
  projectId: string;
  workspaceId: string;
  ownerUserId: string;
  visibility: ExplicitMemoryVisibility;
  content: string;
  contentHash: string;
  tags: string[];
  version: number;
  state: "active" | "forgotten";
  originType: ExplicitMemoryOrigin;
  source: "user-directive" | "context_archive" | "source";
  originId: string | null;
  createdAt: string;
  updatedAt: string;
  forgottenAt: string | null;
}

export interface ExplicitMemoryReceipt {
  receiptId: string;
  operationId: string;
  operation: ExplicitMemoryOperation;
  status: "committed";
  memoryId: string;
  version: number;
  scope: {
    organizationId: string;
    projectId: string;
    workspaceId: string;
    ownerUserId: string;
    visibility: ExplicitMemoryVisibility;
  };
  committedAt: string;
}

export interface ExplicitMemoryMutationResult {
  memory: ExplicitMemory | null;
  receipt: ExplicitMemoryReceipt;
  idempotent: boolean;
}

export interface ExplicitMemoryTombstone {
  memoryId: string;
  organizationId: string;
  projectId: string;
  workspaceId: string;
  ownerUserId: string;
  version: number;
  priorContentHash: string;
  receiptId: string;
  forgottenAt: string;
}

export type ExplicitMemoryStateResolution =
  | { state: "active"; memory: ExplicitMemory }
  | { state: "forgotten"; tombstone: ExplicitMemoryTombstone }
  | { state: "not_found" };

export interface ExplicitMemoryRetrievalItem {
  memory: ExplicitMemory;
  estimatedTokens: number;
  contentKind: "untrusted_memory_data";
  instructionAuthority: false;
}

export interface ExplicitMemoryRetrievalPage {
  items: ExplicitMemoryRetrievalItem[];
  total: number;
  nextOffset: number | null;
  budget: {
    maxItems: number;
    maxTokens: number;
    usedItems: number;
    usedTokens: number;
    truncated: boolean;
  };
}

export type ExplicitMemoryErrorCode =
  | "INVALID_MEMORY_INPUT"
  | "MEMORY_SCOPE_NOT_FOUND"
  | "MEMORY_NOT_FOUND"
  | "MEMORY_CONFLICT"
  | "VERSION_CONFLICT"
  | "OPERATION_CONFLICT";

export class ExplicitMemoryError extends Error {
  constructor(
    public readonly code: ExplicitMemoryErrorCode,
    public readonly currentVersion?: number,
  ) {
    super(code);
    this.name = "ExplicitMemoryError";
  }
}

type Db = ReturnType<typeof getDb>;
type MemoryRow = {
  id: string;
  organization_id: string;
  project_id: string;
  workspace_id: string;
  owner_user_id: string;
  visibility: ExplicitMemoryVisibility;
  content: string;
  content_hash: string;
  tags: string;
  version: number;
  state: "active" | "forgotten";
  origin_type: ExplicitMemoryOrigin;
  origin_id: string | null;
  created_at: string;
  updated_at: string;
  forgotten_at: string | null;
};

type ReceiptRow = {
  request_hash: string;
  result_json: string;
};

type MemoryStateRow = MemoryRow & {
  tombstone_version: number | null;
  tombstone_prior_content_hash: string | null;
  tombstone_receipt_id: string | null;
  tombstone_forgotten_at: string | null;
};

type RestoreSuppressionRow = {
  memory_id: string;
  organization_id: string;
  project_id: string;
  workspace_id: string;
  owner_user_id: string;
  version: number;
  prior_content_hash: string;
  receipt_id: string;
  forgotten_at: string;
};

const OPERATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function requestHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function now(): string {
  return new Date().toISOString();
}

function parseMemory(row: MemoryRow): ExplicitMemory {
  const tags = JSON.parse(row.tags) as unknown;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new Error("Invalid persisted explicit memory tags");
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    visibility: row.visibility,
    content: row.content,
    contentHash: row.content_hash,
    tags,
    version: row.version,
    state: row.state,
    originType: row.origin_type,
    source: row.origin_type === "explicit" ? "user-directive" : row.origin_type,
    originId: row.origin_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    forgottenAt: row.forgotten_at,
  };
}

function parseReceipt(row: ReceiptRow): ExplicitMemoryReceipt {
  const value = JSON.parse(row.result_json) as ExplicitMemoryReceipt;
  if (!value || typeof value !== "object" || value.status !== "committed") {
    throw new Error("Invalid persisted explicit memory receipt");
  }
  return value;
}

function normalizeOperationId(value: unknown): string {
  if (typeof value !== "string" || !OPERATION_ID.test(value)) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return value;
}

function normalizeMemoryId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return value;
}

function normalizeContent(value: unknown): string {
  if (typeof value !== "string") throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  const content = value;
  if (!content.trim() || content.length > 32_768 || estimateTokens(content) > EXPLICIT_MEMORY_MAX_TOKENS
    || hasLikelyContextSourceSecret(content)) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return content;
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32
    || value.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 64
      || hasLikelyContextSourceSecret(tag))) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  const tags = [...new Set(value.map((tag) => (tag as string).trim()))].sort();
  if (Buffer.byteLength(JSON.stringify(tags), "utf8") > 4_096) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return tags;
}

function normalizeVisibility(value: unknown): ExplicitMemoryVisibility {
  const visibility = value ?? "private";
  if (visibility !== "private" && visibility !== "project") {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return visibility;
}

function normalizeVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return value as number;
}

function normalizeLineage(value: unknown): { originType: ExplicitMemoryOrigin; originId: string | null } {
  if (value === undefined) return { originType: "explicit", originId: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  const { type, id } = value as { type?: unknown; id?: unknown };
  if ((type !== "context_archive" && type !== "source") || typeof id !== "string"
    || !id.trim() || id.length > 256) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return { originType: type, originId: id.trim() };
}

function requireVisibility(scope: ExplicitMemoryScope, visibility: ExplicitMemoryVisibility): void {
  if (visibility === "project" && !scope.allowProjectVisibility) {
    throw new ExplicitMemoryError("MEMORY_SCOPE_NOT_FOUND");
  }
}

export function resolveExplicitMemoryScope(input: {
  projectId: string;
  workspaceId: string;
  principal: ExplicitMemoryPrincipal;
  allowProjectVisibility?: boolean;
}): ExplicitMemoryScope {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const timestamp = now();
  const row = input.principal.type === "user"
    ? db.prepare(
      `SELECT workspace.organization_id, workspace.project_id, workspace.id AS workspace_id,
              workspace.owner_user_id
       FROM authorized_workspaces workspace
       JOIN projects project ON project.id = workspace.project_id
       WHERE workspace.id = ? AND workspace.project_id = ? AND workspace.owner_user_id = ?
         AND workspace.status = 'authorized' AND project.archived_at IS NULL`,
    ).get(input.workspaceId, input.projectId, input.principal.userId)
    : db.prepare(
      `SELECT workspace.organization_id, workspace.project_id, workspace.id AS workspace_id,
              workspace.owner_user_id
       FROM authorized_workspaces workspace
       JOIN projects project ON project.id = workspace.project_id
        JOIN mcp_credentials credential
          ON credential.id = ? AND credential.service_principal_id = ?
         AND credential.organization_id = workspace.organization_id
         AND credential.project_id = workspace.project_id
         AND credential.workspace_id = workspace.id
         AND credential.created_by_user_id = workspace.owner_user_id
         AND credential.launcher_worktree = workspace.storage_path
         AND credential.security_epoch = workspace.security_epoch
        AND credential.kind IN ('service', 'runtime')
        AND credential.audience IN ('mcp', 'runtime')
        AND credential.revoked_at IS NULL AND credential.expires_at > ?
       JOIN service_principals principal
         ON principal.id = credential.service_principal_id
        AND principal.organization_id = workspace.organization_id
        AND principal.security_epoch = credential.security_epoch
        AND principal.status = 'active'
       WHERE workspace.id = ? AND workspace.project_id = ?
         AND workspace.storage_mapping_hash = ?
         AND workspace.status = 'authorized' AND project.archived_at IS NULL`,
    ).get(
      input.principal.credentialId,
      input.principal.servicePrincipalId,
      timestamp,
      input.workspaceId,
      input.projectId,
      input.principal.storageMappingHash,
    );
  if (!row) throw new ExplicitMemoryError("MEMORY_SCOPE_NOT_FOUND");
  const scope = row as {
    organization_id: string;
    project_id: string;
    workspace_id: string;
    owner_user_id: string;
  };
  return {
    organizationId: scope.organization_id,
    projectId: scope.project_id,
    workspaceId: scope.workspace_id,
    ownerUserId: scope.owner_user_id,
    allowProjectVisibility: input.allowProjectVisibility === true,
  };
}

function receiptRow(db: Db, scope: ExplicitMemoryScope, operationId: string): ReceiptRow | undefined {
  const receipt = db.prepare(
    `SELECT request_hash, result_json FROM explicit_memory_operation_receipts
     WHERE project_id = ? AND workspace_id = ? AND owner_user_id = ? AND operation_id = ?`,
  ).get(scope.projectId, scope.workspaceId, scope.ownerUserId, operationId) as ReceiptRow | undefined;
  return receipt ?? db.prepare(
    `SELECT request_hash, result_json FROM explicit_memory_restore_suppressions
     WHERE project_id = ? AND workspace_id = ? AND owner_user_id = ? AND operation_id = ?`,
  ).get(scope.projectId, scope.workspaceId, scope.ownerUserId, operationId) as ReceiptRow | undefined;
}

function replayOrConflict(
  db: Db,
  scope: ExplicitMemoryScope,
  operationId: string,
  hash: string,
): ExplicitMemoryReceipt | undefined {
  const existing = receiptRow(db, scope, operationId);
  if (!existing) return undefined;
  if (existing.request_hash !== hash) throw new ExplicitMemoryError("OPERATION_CONFLICT");
  return parseReceipt(existing);
}

function resolveOwnedExplicitMemoryState(
  db: Db,
  scope: ExplicitMemoryScope,
  memoryId: string,
): ExplicitMemoryStateResolution {
  const suppression = db.prepare(
    `SELECT memory_id, organization_id, project_id, workspace_id, owner_user_id,
            version, prior_content_hash, receipt_id, forgotten_at
     FROM explicit_memory_restore_suppressions
     WHERE memory_id = ? AND organization_id = ? AND project_id = ?
       AND workspace_id = ? AND owner_user_id = ?`,
  ).get(
    memoryId,
    scope.organizationId,
    scope.projectId,
    scope.workspaceId,
    scope.ownerUserId,
  ) as RestoreSuppressionRow | undefined;
  if (suppression) {
    return {
      state: "forgotten",
      tombstone: {
        memoryId: suppression.memory_id,
        organizationId: suppression.organization_id,
        projectId: suppression.project_id,
        workspaceId: suppression.workspace_id,
        ownerUserId: suppression.owner_user_id,
        version: suppression.version,
        priorContentHash: suppression.prior_content_hash,
        receiptId: suppression.receipt_id,
        forgottenAt: suppression.forgotten_at,
      },
    };
  }
  const row = db.prepare(
    `SELECT memory.*,
            tombstone.version AS tombstone_version,
            tombstone.prior_content_hash AS tombstone_prior_content_hash,
            tombstone.receipt_id AS tombstone_receipt_id,
            tombstone.forgotten_at AS tombstone_forgotten_at
     FROM explicit_memories memory
     LEFT JOIN explicit_memory_tombstones tombstone ON tombstone.memory_id = memory.id
     WHERE memory.id = ? AND memory.project_id = ? AND memory.workspace_id = ?
       AND memory.owner_user_id = ?`,
  ).get(memoryId, scope.projectId, scope.workspaceId, scope.ownerUserId) as MemoryStateRow | undefined;
  if (!row) return { state: "not_found" };
  if (row.state === "active" && row.tombstone_version === null) {
    return { state: "active", memory: parseMemory(row) };
  }
  if (row.state !== "forgotten" || row.content !== "" || row.content_hash !== sha256("") || row.tags !== "[]"
    || row.tombstone_version !== row.version || row.tombstone_prior_content_hash === null
    || row.tombstone_receipt_id === null || row.tombstone_forgotten_at === null
    || row.tombstone_forgotten_at !== row.forgotten_at) {
    throw new Error("Invalid persisted explicit memory tombstone");
  }
  return {
    state: "forgotten",
    tombstone: {
      memoryId: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      workspaceId: row.workspace_id,
      ownerUserId: row.owner_user_id,
      version: row.tombstone_version,
      priorContentHash: row.tombstone_prior_content_hash,
      receiptId: row.tombstone_receipt_id,
      forgottenAt: row.tombstone_forgotten_at,
    },
  };
}

export function resolveExplicitMemoryState(
  scope: ExplicitMemoryScope,
  memoryIdValue: string,
): ExplicitMemoryStateResolution {
  return resolveOwnedExplicitMemoryState(
    getDb(process.env.INGENIUM_CORE_DB_PATH),
    scope,
    normalizeMemoryId(memoryIdValue),
  );
}

function activeOwnedMemory(db: Db, scope: ExplicitMemoryScope, memoryId: string): ExplicitMemory | undefined {
  const resolved = resolveOwnedExplicitMemoryState(db, scope, memoryId);
  return resolved.state === "active" ? resolved.memory : undefined;
}

function replayResult(db: Db, scope: ExplicitMemoryScope, receipt: ExplicitMemoryReceipt): ExplicitMemoryMutationResult {
  const memory = receipt.operation === "forget" ? null : activeOwnedMemory(db, scope, receipt.memoryId);
  return {
    memory: memory?.version === receipt.version ? memory : null,
    receipt,
    idempotent: true,
  };
}

function insertReceipt(
  db: Db,
  scope: ExplicitMemoryScope,
  input: {
    receiptId: string;
    operationId: string;
    operation: ExplicitMemoryOperation;
    requestHash: string;
    memoryId: string;
    version: number;
    visibility: ExplicitMemoryVisibility;
    committedAt: string;
  },
): ExplicitMemoryReceipt {
  const receipt: ExplicitMemoryReceipt = {
    receiptId: input.receiptId,
    operationId: input.operationId,
    operation: input.operation,
    status: "committed",
    memoryId: input.memoryId,
    version: input.version,
    scope: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      ownerUserId: scope.ownerUserId,
      visibility: input.visibility,
    },
    committedAt: input.committedAt,
  };
  db.prepare(
    `INSERT INTO explicit_memory_operation_receipts
     (id, organization_id, project_id, workspace_id, owner_user_id, operation_id,
      operation, request_hash, result_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?)`,
  ).run(
    input.receiptId,
    scope.organizationId,
    scope.projectId,
    scope.workspaceId,
    scope.ownerUserId,
    input.operationId,
    input.operation,
    input.requestHash,
    JSON.stringify(receipt),
    input.committedAt,
  );
  return receipt;
}

function insertVersion(
  db: Db,
  scope: ExplicitMemoryScope,
  input: {
    memoryId: string;
    version: number;
    operation: ExplicitMemoryOperation;
    contentHash: string;
    tags: string[];
    receiptId: string;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO explicit_memory_versions
     (id, memory_id, organization_id, project_id, workspace_id, owner_user_id,
      version, operation, content_hash, tags_hash, receipt_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.memoryId,
    scope.organizationId,
    scope.projectId,
    scope.workspaceId,
    scope.ownerUserId,
    input.version,
    input.operation,
    input.contentHash,
    sha256(JSON.stringify(input.tags)),
    input.receiptId,
    input.createdAt,
  );
}

export function saveExplicitMemory(scope: ExplicitMemoryScope, input: {
  operationId: string;
  memoryId?: string;
  content: string;
  tags?: string[];
  visibility?: ExplicitMemoryVisibility;
  lineage?: { type: "context_archive" | "source"; id: string };
}): ExplicitMemoryMutationResult {
  const operationId = normalizeOperationId(input.operationId);
  const content = normalizeContent(input.content);
  const tags = normalizeTags(input.tags === undefined && input.lineage === undefined ? ["preference"] : input.tags);
  const visibility = normalizeVisibility(input.visibility);
  const lineage = normalizeLineage(input.lineage);
  requireVisibility(scope, visibility);
  const suppliedMemoryId = input.memoryId === undefined ? undefined : normalizeMemoryId(input.memoryId);
  const hash = requestHash({ operation: "save", suppliedMemoryId, content, tags, visibility, lineage, scope });
  const outcome = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const replay = replayOrConflict(db, scope, operationId, hash);
    if (replay) return { result: replayResult(db, scope, replay), wrote: false };
    const parent = resolveExplicitMemoryScope({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      principal: { type: "user", userId: scope.ownerUserId },
    });
    if (parent.organizationId !== scope.organizationId) throw new ExplicitMemoryError("MEMORY_SCOPE_NOT_FOUND");
    const memoryId = suppliedMemoryId ?? randomUUID();
    if (db.prepare("SELECT 1 FROM explicit_memories WHERE id = ?").get(memoryId)
      || db.prepare("SELECT 1 FROM explicit_memory_restore_suppressions WHERE memory_id = ?").get(memoryId)) {
      throw new ExplicitMemoryError("MEMORY_CONFLICT");
    }
    const timestamp = now();
    const contentHash = sha256(content);
    const receiptId = randomUUID();
    db.prepare(
      `INSERT INTO explicit_memories
       (id, organization_id, project_id, workspace_id, owner_user_id, visibility,
        content, content_hash, tags, version, state, origin_type, origin_id,
        created_at, updated_at, forgotten_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?, NULL)`,
    ).run(
      memoryId,
      scope.organizationId,
      scope.projectId,
      scope.workspaceId,
      scope.ownerUserId,
      visibility,
      content,
      contentHash,
      JSON.stringify(tags),
      lineage.originType,
      lineage.originId,
      timestamp,
      timestamp,
    );
    const receipt = insertReceipt(db, scope, {
      receiptId,
      operationId,
      operation: "save",
      requestHash: hash,
      memoryId,
      version: 1,
      visibility,
      committedAt: timestamp,
    });
    insertVersion(db, scope, {
      memoryId,
      version: 1,
      operation: "save",
      contentHash,
      tags,
      receiptId,
      createdAt: timestamp,
    });
    return {
      result: { memory: activeOwnedMemory(db, scope, memoryId)!, receipt, idempotent: false },
      wrote: true,
    };
  });
  if (outcome.wrote) checkpointAfterWrite();
  return outcome.result;
}

export function updateExplicitMemory(scope: ExplicitMemoryScope, memoryIdValue: string, input: {
  operationId: string;
  expectedVersion: number;
  content: string;
  tags?: string[];
}): ExplicitMemoryMutationResult {
  const memoryId = normalizeMemoryId(memoryIdValue);
  const operationId = normalizeOperationId(input.operationId);
  const expectedVersion = normalizeVersion(input.expectedVersion);
  const content = normalizeContent(input.content);
  const suppliedTags = input.tags === undefined ? undefined : normalizeTags(input.tags);
  const hash = requestHash({ operation: "update", memoryId, expectedVersion, content, tags: suppliedTags, scope });
  const outcome = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const replay = replayOrConflict(db, scope, operationId, hash);
    if (replay) return { result: replayResult(db, scope, replay), wrote: false };
    const current = activeOwnedMemory(db, scope, memoryId);
    if (!current) throw new ExplicitMemoryError("MEMORY_NOT_FOUND");
    requireVisibility(scope, current.visibility);
    if (current.version !== expectedVersion) {
      throw new ExplicitMemoryError("VERSION_CONFLICT", current.version);
    }
    const tags = suppliedTags ?? current.tags;
    const timestamp = now();
    const version = expectedVersion + 1;
    const contentHash = sha256(content);
    const receiptId = randomUUID();
    const updated = db.prepare(
      `UPDATE explicit_memories
       SET content = ?, content_hash = ?, tags = ?, version = ?, updated_at = ?
       WHERE id = ? AND project_id = ? AND workspace_id = ? AND owner_user_id = ?
         AND state = 'active' AND version = ?`,
    ).run(
      content,
      contentHash,
      JSON.stringify(tags),
      version,
      timestamp,
      memoryId,
      scope.projectId,
      scope.workspaceId,
      scope.ownerUserId,
      expectedVersion,
    );
    if (updated.changes !== 1) throw new ExplicitMemoryError("VERSION_CONFLICT");
    const receipt = insertReceipt(db, scope, {
      receiptId,
      operationId,
      operation: "update",
      requestHash: hash,
      memoryId,
      version,
      visibility: current.visibility,
      committedAt: timestamp,
    });
    insertVersion(db, scope, {
      memoryId,
      version,
      operation: "update",
      contentHash,
      tags,
      receiptId,
      createdAt: timestamp,
    });
    return {
      result: { memory: activeOwnedMemory(db, scope, memoryId)!, receipt, idempotent: false },
      wrote: true,
    };
  });
  if (outcome.wrote) checkpointAfterWrite();
  return outcome.result;
}

export function forgetExplicitMemory(scope: ExplicitMemoryScope, memoryIdValue: string, input: {
  operationId: string;
  expectedVersion: number;
}): ExplicitMemoryMutationResult {
  const memoryId = normalizeMemoryId(memoryIdValue);
  const operationId = normalizeOperationId(input.operationId);
  const expectedVersion = normalizeVersion(input.expectedVersion);
  const hash = requestHash({ operation: "forget", memoryId, expectedVersion, scope });
  const outcome = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const replay = replayOrConflict(db, scope, operationId, hash);
    if (replay) return { result: replayResult(db, scope, replay), wrote: false };
    const current = activeOwnedMemory(db, scope, memoryId);
    if (!current) throw new ExplicitMemoryError("MEMORY_NOT_FOUND");
    requireVisibility(scope, current.visibility);
    if (current.version !== expectedVersion) {
      throw new ExplicitMemoryError("VERSION_CONFLICT", current.version);
    }
    const timestamp = now();
    const version = expectedVersion + 1;
    const receiptId = randomUUID();
    const forgotten = db.prepare(
      `UPDATE explicit_memories
       SET content = '', content_hash = ?, tags = '[]', version = ?, state = 'forgotten',
           updated_at = ?, forgotten_at = ?
       WHERE id = ? AND project_id = ? AND workspace_id = ? AND owner_user_id = ?
         AND state = 'active' AND version = ?`,
    ).run(
      sha256(""),
      version,
      timestamp,
      timestamp,
      memoryId,
      scope.projectId,
      scope.workspaceId,
      scope.ownerUserId,
      expectedVersion,
    );
    if (forgotten.changes !== 1) throw new ExplicitMemoryError("VERSION_CONFLICT");
    const receipt = insertReceipt(db, scope, {
      receiptId,
      operationId,
      operation: "forget",
      requestHash: hash,
      memoryId,
      version,
      visibility: current.visibility,
      committedAt: timestamp,
    });
    db.prepare(
      `INSERT INTO explicit_memory_tombstones
       (memory_id, organization_id, project_id, workspace_id, owner_user_id,
        version, prior_content_hash, receipt_id, forgotten_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      memoryId,
      scope.organizationId,
      scope.projectId,
      scope.workspaceId,
      scope.ownerUserId,
      version,
      current.contentHash,
      receiptId,
      timestamp,
    );
    insertVersion(db, scope, {
      memoryId,
      version,
      operation: "forget",
      contentHash: current.contentHash,
      tags: [],
      receiptId,
      createdAt: timestamp,
    });
    return { result: { memory: null, receipt, idempotent: false }, wrote: true };
  });
  if (outcome.wrote) checkpointAfterWrite();
  return outcome.result;
}

function readPredicate(
  scope: ExplicitMemoryScope,
  visibility: ExplicitMemoryVisibility,
): { sql: string; parameters: string[] } {
  requireVisibility(scope, visibility);
  return visibility === "private"
    ? {
        sql: "memory.project_id = ? AND memory.workspace_id = ? AND memory.owner_user_id = ? AND memory.visibility = 'private'",
        parameters: [scope.projectId, scope.workspaceId, scope.ownerUserId],
      }
    : {
        sql: "memory.project_id = ? AND memory.visibility = 'project'",
        parameters: [scope.projectId],
      };
}

export function readExplicitMemory(
  scope: ExplicitMemoryScope,
  memoryIdValue: string,
  visibility: ExplicitMemoryVisibility = "private",
): ExplicitMemoryRetrievalItem | undefined {
  const memoryId = normalizeMemoryId(memoryIdValue);
  const predicate = readPredicate(scope, visibility);
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT memory.* FROM explicit_memories memory
     WHERE memory.id = ? AND ${predicate.sql} AND memory.state = 'active'
       AND NOT EXISTS (SELECT 1 FROM explicit_memory_tombstones tombstone WHERE tombstone.memory_id = memory.id)
       AND NOT EXISTS (SELECT 1 FROM explicit_memory_restore_suppressions suppression WHERE suppression.memory_id = memory.id)`,
  ).get(memoryId, ...predicate.parameters) as MemoryRow | undefined;
  if (!row) return undefined;
  const memory = parseMemory(row);
  return {
    memory,
    estimatedTokens: estimateTokens(memory.content),
    contentKind: "untrusted_memory_data",
    instructionAuthority: false,
  };
}

function normalizeBudget(options: { maxItems?: number; maxTokens?: number; offset?: number } = {}) {
  const maxItems = options.maxItems ?? EXPLICIT_MEMORY_MAX_ITEMS;
  const maxTokens = options.maxTokens ?? EXPLICIT_MEMORY_MAX_TOKENS;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > EXPLICIT_MEMORY_MAX_ITEMS
    || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > EXPLICIT_MEMORY_MAX_TOKENS
    || !Number.isSafeInteger(offset) || offset < 0) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return { maxItems, maxTokens, offset };
}

function budgetPage(
  rows: MemoryRow[],
  total: number,
  budget: { maxItems: number; maxTokens: number; offset: number },
): ExplicitMemoryRetrievalPage {
  const items: ExplicitMemoryRetrievalItem[] = [];
  let usedTokens = 0;
  let scanned = 0;
  for (const row of rows) {
    if (items.length >= budget.maxItems) break;
    const memory = parseMemory(row);
    const estimatedTokens = estimateTokens(memory.content);
    if (usedTokens + estimatedTokens > budget.maxTokens) {
      if (items.length > 0) break;
      scanned++;
      continue;
    }
    scanned++;
    usedTokens += estimatedTokens;
    items.push({
      memory,
      estimatedTokens,
      contentKind: "untrusted_memory_data",
      instructionAuthority: false,
    });
  }
  const consumed = Math.max(scanned, items.length);
  const hasMore = budget.offset + consumed < total;
  return {
    items,
    total,
    nextOffset: hasMore ? budget.offset + consumed : null,
    budget: {
      maxItems: budget.maxItems,
      maxTokens: budget.maxTokens,
      usedItems: items.length,
      usedTokens,
      truncated: hasMore || items.length < Math.min(total - budget.offset, budget.maxItems),
    },
  };
}

export function listExplicitMemories(
  scope: ExplicitMemoryScope,
  visibility: ExplicitMemoryVisibility = "private",
  options: { maxItems?: number; maxTokens?: number; offset?: number } = {},
): ExplicitMemoryRetrievalPage {
  const predicate = readPredicate(scope, visibility);
  const budget = normalizeBudget(options);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const active = `FROM explicit_memories memory
    WHERE ${predicate.sql} AND memory.state = 'active'
      AND NOT EXISTS (SELECT 1 FROM explicit_memory_tombstones tombstone WHERE tombstone.memory_id = memory.id)
      AND NOT EXISTS (SELECT 1 FROM explicit_memory_restore_suppressions suppression WHERE suppression.memory_id = memory.id)`;
  const total = (db.prepare(`SELECT count(*) AS total ${active}`).get(...predicate.parameters) as { total: number }).total;
  const rows = db.prepare(
    `SELECT memory.* ${active}
     ORDER BY memory.updated_at DESC, memory.id DESC LIMIT ? OFFSET ?`,
  ).all(...predicate.parameters, budget.maxItems + 1, budget.offset) as MemoryRow[];
  return budgetPage(rows, total, budget);
}

export function searchExplicitMemories(
  scope: ExplicitMemoryScope,
  query: string,
  visibility: ExplicitMemoryVisibility = "private",
  options: { maxItems?: number; maxTokens?: number; offset?: number } = {},
): ExplicitMemoryRetrievalPage {
  const predicate = readPredicate(scope, visibility);
  const budget = normalizeBudget(options);
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return budgetPage([], 0, budget);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const active = `FROM explicit_memories memory
    JOIN explicit_memories_fts fts ON fts.rowid = memory.rowid
    WHERE ${predicate.sql} AND memory.state = 'active' AND explicit_memories_fts MATCH ?
      AND NOT EXISTS (SELECT 1 FROM explicit_memory_tombstones tombstone WHERE tombstone.memory_id = memory.id)
      AND NOT EXISTS (SELECT 1 FROM explicit_memory_restore_suppressions suppression WHERE suppression.memory_id = memory.id)`;
  const parameters = [...predicate.parameters, sanitized];
  const total = (db.prepare(`SELECT count(*) AS total ${active}`).get(...parameters) as { total: number }).total;
  const rows = db.prepare(
    `SELECT memory.* ${active}
     ORDER BY bm25(explicit_memories_fts), memory.updated_at DESC, memory.id DESC LIMIT ? OFFSET ?`,
  ).all(...parameters, budget.maxItems + 1, budget.offset) as MemoryRow[];
  return budgetPage(rows, total, budget);
}

export function getExplicitMemoryOperationStatus(
  scope: ExplicitMemoryScope,
  operationIdValue: string,
): { status: "committed"; receipt: ExplicitMemoryReceipt } | { status: "unknown"; operationId: string } {
  const operationId = normalizeOperationId(operationIdValue);
  const row = receiptRow(getDb(process.env.INGENIUM_CORE_DB_PATH), scope, operationId);
  return row
    ? { status: "committed", receipt: parseReceipt(row) }
    : { status: "unknown", operationId };
}

export function isExplicitMemorySuppressed(scope: ExplicitMemoryScope, memoryIdValue: string): boolean {
  return resolveExplicitMemoryState(scope, memoryIdValue).state === "forgotten";
}

export function listExplicitMemoryTombstones(scope: ExplicitMemoryScope, limit = 100): ExplicitMemoryTombstone[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  const rows = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT memory_id, version, prior_content_hash, receipt_id, forgotten_at FROM (
       SELECT memory_id, version, prior_content_hash, receipt_id, forgotten_at
       FROM explicit_memory_tombstones
       WHERE project_id = ? AND workspace_id = ? AND owner_user_id = ?
       UNION
       SELECT memory_id, version, prior_content_hash, receipt_id, forgotten_at
       FROM explicit_memory_restore_suppressions
       WHERE project_id = ? AND workspace_id = ? AND owner_user_id = ?
     )
     ORDER BY forgotten_at DESC, memory_id DESC LIMIT ?`,
  ).all(
    scope.projectId,
    scope.workspaceId,
    scope.ownerUserId,
    scope.projectId,
    scope.workspaceId,
    scope.ownerUserId,
    limit,
  ) as Array<{
    memory_id: string;
    version: number;
    prior_content_hash: string;
    receipt_id: string;
    forgotten_at: string;
  }>;
  return rows.map((row) => ({
    memoryId: row.memory_id,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    ownerUserId: scope.ownerUserId,
    version: row.version,
    priorContentHash: row.prior_content_hash,
    receiptId: row.receipt_id,
    forgottenAt: row.forgotten_at,
  }));
}
