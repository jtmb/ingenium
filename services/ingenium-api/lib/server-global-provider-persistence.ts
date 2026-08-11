import {
  checkpointAfterWrite,
  execTransaction,
  getDb,
  projects,
  settings,
  vault,
} from "ingenium-core";
import {
  isOpenCodeError,
  opencodeClient,
  type AuthStatusResponse,
  type OpenCodeResult,
} from "./opencode-client.js";

const MANAGED_PROVIDER_CREDENTIAL_PREFIX = "Managed LLM API Key: ";
const NATIVE_PROVIDER_CREDENTIAL_PREFIX = "OpenCode Native Provider API Key: ";
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const PROVIDER_METADATA_KEYS = [
  "llm_provider_configs",
  "synthesis_provider",
  "synthesis_model",
  "synthesis_endpoint",
  "synthesis_allow_private_network",
  "synthesis_backup_provider",
  "synthesis_backup_model",
  "synthesis_backup_endpoint",
  "synthesis_backup_allow_private_network",
  "chat_selection",
] as const;

type ProviderCredentialKind = "managed" | "native";

interface VaultProviderItem {
  id: string;
  name: string;
  providerId: string;
  kind: ProviderCredentialKind;
  projectId: string;
}

interface ProviderSettingRow {
  project_id: string;
  key: string;
  value: string;
}

export type NativeProviderCredentialPersistenceStatus =
  | "stored"
  | "absent"
  | "conflict"
  | "vault_unavailable"
  | "global_unavailable";

/** Limits are intentionally fixed so provider credentials cannot form an unbounded in-memory queue. */
export const NATIVE_PROVIDER_MAX_WAITERS = 4;
export const NATIVE_PROVIDER_QUEUE_WAIT_TIMEOUT_MS = 2_000;
export const NATIVE_PROVIDER_OPERATION_TIMEOUT_MS = 5_000;

interface StoredNativeProviderCredentialSnapshot {
  state: "stored";
  projectId: string;
  providerId: string;
  item: VaultProviderItem;
  value: string;
}

interface AbsentNativeProviderCredentialSnapshot {
  state: "absent";
  projectId: string;
  providerId: string;
}

type NativeProviderCredentialSnapshot =
  | StoredNativeProviderCredentialSnapshot
  | AbsentNativeProviderCredentialSnapshot;

type NativeProviderCredentialSnapshotResult =
  | { snapshot: NativeProviderCredentialSnapshot }
  | { persistence: NativeProviderCredentialPersistenceStatus };

export interface NativeProviderOpenCodeOperations {
  apply: (key: string, signal: AbortSignal) => Promise<OpenCodeResult<unknown>>;
  remove: (signal: AbortSignal) => Promise<OpenCodeResult<unknown>>;
  status: (signal: AbortSignal) => Promise<OpenCodeResult<AuthStatusResponse>>;
}

export interface NativeProviderQueueRejected {
  outcome: "queue_rejected";
  retryable: true;
}

export type NativeProviderConnectSagaResult =
  | { outcome: "connected" }
  | NativeProviderQueueRejected
  | {
    outcome: "persistence_failed";
    persistence: NativeProviderCredentialPersistenceStatus;
  }
  | {
    outcome: "connection_failed";
    compensation: "restored" | "recoverable";
  };

export type NativeProviderDisconnectSagaResult =
  | { outcome: "disconnected" }
  | NativeProviderQueueRejected
  | {
    outcome: "persistence_failed";
    persistence: NativeProviderCredentialPersistenceStatus;
  }
  | { outcome: "disconnect_failed" }
  | {
    outcome: "vault_delete_failed";
    compensation: "restored" | "recoverable";
  };

interface NativeProviderSagaPermit {
  release: () => void;
}

interface NativeProviderSagaWaiter {
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: NativeProviderSagaPermit | NativeProviderQueueRejected) => void;
}

interface NativeProviderSagaQueue {
  active: boolean;
  waiters: NativeProviderSagaWaiter[];
}

const nativeProviderSagas = new Map<string, NativeProviderSagaQueue>();

export interface ProviderRecoveryResult {
  migratedSettings: number;
  migratedCredentials: number;
  conflicts: number;
  skippedForVault: boolean;
  globalUnavailable: boolean;
}

export interface ProviderRehydrationResult {
  restored: number;
  failed: number;
  skippedForVault: boolean;
  globalUnavailable: boolean;
  nativeOAuth: "unrecoverable_without_durable_credential";
}

function emptyRecoveryResult(): ProviderRecoveryResult {
  return {
    migratedSettings: 0,
    migratedCredentials: 0,
    conflicts: 0,
    skippedForVault: false,
    globalUnavailable: false,
  };
}

function emptyRehydrationResult(): ProviderRehydrationResult {
  return {
    restored: 0,
    failed: 0,
    skippedForVault: false,
    globalUnavailable: false,
    nativeOAuth: "unrecoverable_without_durable_credential",
  };
}

function providerCredentialName(kind: ProviderCredentialKind, providerId: string): string {
  return `${kind === "managed" ? MANAGED_PROVIDER_CREDENTIAL_PREFIX : NATIVE_PROVIDER_CREDENTIAL_PREFIX}${providerId}`;
}

function isProviderId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ID_PATTERN.test(value);
}

function parseProviderCredentialItem(
  projectId: string,
  item: Record<string, unknown>,
): VaultProviderItem | undefined {
  if (typeof item.id !== "string" || typeof item.name !== "string") return undefined;
  const prefix = item.name.startsWith(MANAGED_PROVIDER_CREDENTIAL_PREFIX)
    ? MANAGED_PROVIDER_CREDENTIAL_PREFIX
    : item.name.startsWith(NATIVE_PROVIDER_CREDENTIAL_PREFIX)
      ? NATIVE_PROVIDER_CREDENTIAL_PREFIX
      : undefined;
  if (!prefix) return undefined;
  const providerId = item.name.slice(prefix.length);
  if (!isProviderId(providerId)) return undefined;
  return {
    id: item.id,
    name: item.name,
    providerId,
    kind: prefix === MANAGED_PROVIDER_CREDENTIAL_PREFIX ? "managed" : "native",
    projectId,
  };
}

function listProviderCredentialItems(projectId: string): VaultProviderItem[] {
  try {
    return vault.listItems(projectId)
      .flatMap((item) => parseProviderCredentialItem(projectId, item as Record<string, unknown>) ?? []);
  } catch {
    return [];
  }
}

function getCanonicalGlobalProjectId(): string | undefined {
  try {
    return projects.getCanonicalGlobalProject()?.id;
  } catch {
    return undefined;
  }
}

function matchingCredentialItems(
  projectId: string,
  kind: ProviderCredentialKind,
  providerId: string,
): VaultProviderItem[] {
  return listProviderCredentialItems(projectId).filter((item) =>
    item.kind === kind && item.providerId === providerId,
  );
}

function matchingNativeProviderCredentialItems(
  projectId: string,
  providerId: string,
): VaultProviderItem[] {
  return vault.listItems(projectId)
    .flatMap((item) => parseProviderCredentialItem(projectId, item as Record<string, unknown>) ?? [])
    .filter((item) => item.kind === "native" && item.providerId === providerId);
}

function snapshotNativeProviderCredential(
  providerId: string,
): NativeProviderCredentialSnapshotResult {
  if (!isProviderId(providerId)) return { persistence: "global_unavailable" };
  const globalProjectId = getCanonicalGlobalProjectId();
  if (!globalProjectId) return { persistence: "global_unavailable" };

  try {
    if (vault.isSealed()) return { persistence: "vault_unavailable" };
    const existing = matchingNativeProviderCredentialItems(globalProjectId, providerId);
    if (existing.length > 1) return { persistence: "conflict" };
    if (existing.length === 0) {
      return { snapshot: { state: "absent", projectId: globalProjectId, providerId } };
    }
    const item = existing[0]!;
    const value = vault.decryptItem(globalProjectId, item.id);
    if (value === null) return { persistence: "vault_unavailable" };
    return {
      snapshot: {
        state: "stored",
        projectId: globalProjectId,
        providerId,
        item,
        value,
      },
    };
  } catch {
    return { persistence: "vault_unavailable" };
  }
}

function nativeCredentialMatches(
  projectId: string,
  providerId: string,
  expectedValue: string,
): boolean {
  try {
    const existing = matchingNativeProviderCredentialItems(projectId, providerId);
    return existing.length === 1
      && vault.decryptItem(projectId, existing[0]!.id) === expectedValue;
  } catch {
    return false;
  }
}

function writeNativeProviderCredential(
  snapshot: NativeProviderCredentialSnapshot,
  value: string,
): boolean {
  try {
    const existing = matchingNativeProviderCredentialItems(snapshot.projectId, snapshot.providerId);
    if (existing.length > 1) return false;
    if (snapshot.state === "absent" && existing.length !== 0) return false;
    if (existing.length === 1) {
      vault.updateItem(snapshot.projectId, existing[0]!.id, value);
    } else {
      const itemId = vault.createItem(
        snapshot.projectId,
        providerCredentialName("native", snapshot.providerId),
        "api_key",
        value,
      );
      if (!itemId || itemId === "Vault is sealed") return false;
    }
    return nativeCredentialMatches(snapshot.projectId, snapshot.providerId, value);
  } catch {
    return false;
  }
}

function removeNativeProviderCredentialSnapshot(snapshot: NativeProviderCredentialSnapshot): boolean {
  try {
    const existing = matchingNativeProviderCredentialItems(snapshot.projectId, snapshot.providerId);
    if (existing.length === 0) return true;
    if (existing.length > 1) return false;
    vault.deleteItem(snapshot.projectId, existing[0]!.id);
    return matchingNativeProviderCredentialItems(snapshot.projectId, snapshot.providerId).length === 0;
  } catch {
    return false;
  }
}

function restoreNativeProviderCredentialSnapshot(snapshot: NativeProviderCredentialSnapshot): boolean {
  if (snapshot.state === "absent") return removeNativeProviderCredentialSnapshot(snapshot);
  return writeNativeProviderCredential(snapshot, snapshot.value);
}

function queueRejected(): NativeProviderQueueRejected {
  return { outcome: "queue_rejected", retryable: true };
}

function isNativeProviderQueueRejected(
  value: NativeProviderSagaPermit | NativeProviderQueueRejected,
): value is NativeProviderQueueRejected {
  return "outcome" in value;
}

function createNativeProviderSagaPermit(
  providerId: string,
  queue: NativeProviderSagaQueue,
): NativeProviderSagaPermit {
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      releaseNativeProviderSagaPermit(providerId, queue);
    },
  };
}

function releaseNativeProviderSagaPermit(providerId: string, queue: NativeProviderSagaQueue): void {
  while (queue.waiters.length > 0) {
    const waiter = queue.waiters.shift()!;
    clearTimeout(waiter.timer);
    if (waiter.expiresAt <= Date.now()) {
      waiter.resolve(queueRejected());
      continue;
    }
    waiter.resolve(createNativeProviderSagaPermit(providerId, queue));
    return;
  }
  queue.active = false;
  if (nativeProviderSagas.get(providerId) === queue) nativeProviderSagas.delete(providerId);
}

function acquireNativeProviderSagaPermit(
  providerId: string,
): Promise<NativeProviderSagaPermit | NativeProviderQueueRejected> {
  const queue = nativeProviderSagas.get(providerId);
  if (!queue) {
    const created: NativeProviderSagaQueue = { active: true, waiters: [] };
    nativeProviderSagas.set(providerId, created);
    return Promise.resolve(createNativeProviderSagaPermit(providerId, created));
  }
  if (queue.waiters.length >= NATIVE_PROVIDER_MAX_WAITERS) return Promise.resolve(queueRejected());

  return new Promise((resolve) => {
    const expiresAt = Date.now() + NATIVE_PROVIDER_QUEUE_WAIT_TIMEOUT_MS;
    const waiter = {
      expiresAt,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      resolve,
    } satisfies NativeProviderSagaWaiter;
    waiter.timer = setTimeout(() => {
      const index = queue.waiters.indexOf(waiter);
      if (index < 0) return;
      queue.waiters.splice(index, 1);
      waiter.resolve(queueRejected());
    }, NATIVE_PROVIDER_QUEUE_WAIT_TIMEOUT_MS);
    queue.waiters.push(waiter);
  });
}

export async function callOpenCodeWithProviderDeadline<T>(
  operation: (signal: AbortSignal) => Promise<OpenCodeResult<T>>,
  timeoutMs = NATIVE_PROVIDER_OPERATION_TIMEOUT_MS,
): Promise<OpenCodeResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<OpenCodeResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ error: { code: "OPENCODE_OPERATION_TIMEOUT", message: "OpenCode operation timed out" } });
    }, timeoutMs);
  });
  const request = Promise.resolve()
    .then(() => operation(controller.signal))
    .catch(() => ({ error: { code: "OPENCODE_OPERATION_FAILED", message: "OpenCode operation failed" } }));
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isOpenCodeNotFound(result: OpenCodeResult<unknown>): boolean {
  return isOpenCodeError(result) && (
    result.error.status === 404
    || result.error.code === "HTTP_404"
    || result.error.code === "NotFoundError"
  );
}

async function getOpenCodeConnectionState(
  providerId: string,
  operations: NativeProviderOpenCodeOperations,
): Promise<"absent" | "connected" | "unknown"> {
  const status = await callOpenCodeWithProviderDeadline((signal) => operations.status(signal));
  if (isOpenCodeError(status)) return "unknown";
  return status.providers.some((provider) => provider.providerId === providerId && provider.connected)
    ? "connected"
    : "absent";
}

async function compensateFailedNativeProviderConnect(
  snapshot: NativeProviderCredentialSnapshot,
  operations: NativeProviderOpenCodeOperations,
): Promise<boolean> {
  if (snapshot.state === "stored") {
    const vaultRestored = restoreNativeProviderCredentialSnapshot(snapshot);
    const openCodeRestored = await callOpenCodeWithProviderDeadline((signal) => operations.apply(snapshot.value, signal));
    return vaultRestored && !isOpenCodeError(openCodeRestored);
  }

  const removed = await callOpenCodeWithProviderDeadline((signal) => operations.remove(signal));
  const openCodeAbsent = !isOpenCodeError(removed)
    || isOpenCodeNotFound(removed)
    || await getOpenCodeConnectionState(snapshot.providerId, operations) === "absent";
  return openCodeAbsent && restoreNativeProviderCredentialSnapshot(snapshot);
}

export async function connectNativeProviderCredential(
  providerId: string,
  value: string,
  operations: NativeProviderOpenCodeOperations,
): Promise<NativeProviderConnectSagaResult> {
  const permit = await acquireNativeProviderSagaPermit(providerId);
  if (isNativeProviderQueueRejected(permit)) return permit;
  try {
    const snapshotResult = snapshotNativeProviderCredential(providerId);
    if ("persistence" in snapshotResult) {
      return { outcome: "persistence_failed", persistence: snapshotResult.persistence };
    }
    const snapshot = snapshotResult.snapshot;
    if (!writeNativeProviderCredential(snapshot, value)) {
      restoreNativeProviderCredentialSnapshot(snapshot);
      return { outcome: "persistence_failed", persistence: "vault_unavailable" };
    }

    const applied = await callOpenCodeWithProviderDeadline((signal) => operations.apply(value, signal));
    if (!isOpenCodeError(applied)) return { outcome: "connected" };

    return {
      outcome: "connection_failed",
      compensation: await compensateFailedNativeProviderConnect(snapshot, operations)
        ? "restored"
        : "recoverable",
    };
  } finally {
    permit.release();
  }
}

export async function disconnectNativeProviderCredential(
  providerId: string,
  operations: NativeProviderOpenCodeOperations,
): Promise<NativeProviderDisconnectSagaResult> {
  const permit = await acquireNativeProviderSagaPermit(providerId);
  if (isNativeProviderQueueRejected(permit)) return permit;
  try {
    const snapshotResult = snapshotNativeProviderCredential(providerId);
    if ("persistence" in snapshotResult) {
      return { outcome: "persistence_failed", persistence: snapshotResult.persistence };
    }
    const snapshot = snapshotResult.snapshot;
    const removed = await callOpenCodeWithProviderDeadline((signal) => operations.remove(signal));
    const openCodeState = !isOpenCodeError(removed) || isOpenCodeNotFound(removed)
      ? "absent"
      : await getOpenCodeConnectionState(providerId, operations);
    if (openCodeState !== "absent") return { outcome: "disconnect_failed" };
    if (snapshot.state === "absent") return { outcome: "disconnected" };
    if (removeNativeProviderCredentialSnapshot(snapshot)) return { outcome: "disconnected" };

    const vaultRestored = restoreNativeProviderCredentialSnapshot(snapshot);
    const openCodeRestored = await callOpenCodeWithProviderDeadline((signal) => operations.apply(snapshot.value, signal));
    return {
      outcome: "vault_delete_failed",
      compensation: vaultRestored && !isOpenCodeError(openCodeRestored)
        ? "restored"
        : "recoverable",
    };
  } finally {
    permit.release();
  }
}

export function storeNativeProviderCredential(providerId: string, value: string): NativeProviderCredentialPersistenceStatus {
  if (!value) return "global_unavailable";
  const snapshotResult = snapshotNativeProviderCredential(providerId);
  if ("persistence" in snapshotResult) return snapshotResult.persistence;
  const snapshot = snapshotResult.snapshot;
  if (writeNativeProviderCredential(snapshot, value)) return "stored";
  restoreNativeProviderCredentialSnapshot(snapshot);
  return "vault_unavailable";
}

export function removeNativeProviderCredential(providerId: string): NativeProviderCredentialPersistenceStatus {
  const snapshotResult = snapshotNativeProviderCredential(providerId);
  if ("persistence" in snapshotResult) return snapshotResult.persistence;
  const snapshot = snapshotResult.snapshot;
  if (snapshot.state === "absent") return "absent";
  return removeNativeProviderCredentialSnapshot(snapshot) ? "stored" : "vault_unavailable";
}

function migrateProviderMetadata(
  globalProjectId: string,
  sourceProjectIds: string[],
  result: ProviderRecoveryResult,
): void {
  if (sourceProjectIds.length === 0) return;
  const placeholders = PROVIDER_METADATA_KEYS.map(() => "?").join(", ");
  const sourcePlaceholders = sourceProjectIds.map(() => "?").join(", ");
  let changed = false;
  execTransaction(() => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT s.project_id, s.key, s.value
       FROM settings s
        WHERE s.project_id IN (${sourcePlaceholders}) AND s.key IN (${placeholders})
        ORDER BY s.key, s.project_id`,
    ).all(...sourceProjectIds, ...PROVIDER_METADATA_KEYS) as ProviderSettingRow[];
    const byKey = new Map<string, ProviderSettingRow[]>();
    for (const row of rows) {
      const candidates = byKey.get(row.key) ?? [];
      candidates.push(row);
      byKey.set(row.key, candidates);
    }

    for (const [key, candidates] of byKey) {
      const destination = db.prepare(
        "SELECT value FROM settings WHERE project_id = ? AND key = ?",
      ).get(globalProjectId, key) as { value: string } | undefined;
      const values = new Set(candidates.map((candidate) => candidate.value));
      if (destination && [...values].some((value) => value !== destination.value)) {
        result.conflicts++;
        continue;
      }
      if (!destination && values.size !== 1) {
        result.conflicts++;
        continue;
      }
      if (!destination) {
        const value = candidates[0]!.value;
        const inserted = db.prepare(
          `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(project_id, key) DO NOTHING`,
        ).run(globalProjectId, key, value);
        if (inserted.changes !== 1) {
          result.conflicts++;
          continue;
        }
      }
      for (const candidate of candidates) {
        db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ? AND value = ?")
          .run(candidate.project_id, candidate.key, candidate.value);
        result.migratedSettings++;
        changed = true;
      }
    }
  });
  if (changed) checkpointAfterWrite();
}

function rewriteMigratedManagedCredentialReference(
  globalProjectId: string,
  providerId: string,
  sourceItemId: string,
  destinationItemId: string,
): boolean {
  try {
    const raw = settings.getSetting(globalProjectId, "llm_provider_configs");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    const matches = parsed.filter((provider): provider is { id?: unknown; credentialItemId?: unknown } =>
      !!provider && typeof provider === "object" && (provider as { id?: unknown }).id === providerId,
    );
    if (matches.length !== 1) return false;
    const provider = matches[0]!;
    if (provider.credentialItemId !== undefined && provider.credentialItemId !== sourceItemId) return false;
    provider.credentialItemId = destinationItemId;
    settings.setSetting(globalProjectId, "llm_provider_configs", JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}

function migrateProviderCredentials(
  globalProjectId: string,
  sourceProjectIds: string[],
  result: ProviderRecoveryResult,
): void {
  if (vault.isSealed()) {
    result.skippedForVault = true;
    return;
  }

  const candidates = new Map<string, VaultProviderItem[]>();
  for (const sourceProjectId of sourceProjectIds) {
    for (const item of listProviderCredentialItems(sourceProjectId)) {
      const key = `${item.kind}\u0000${item.providerId}`;
      const group = candidates.get(key) ?? [];
      group.push(item);
      candidates.set(key, group);
    }
  }

  for (const sourceItems of candidates.values()) {
    if (sourceItems.length !== 1) {
      result.conflicts++;
      continue;
    }
    const source = sourceItems[0]!;
    const destination = matchingCredentialItems(globalProjectId, source.kind, source.providerId);
    if (destination.length > 1) {
      result.conflicts++;
      continue;
    }

    const sourceValue = vault.decryptItem(source.projectId, source.id);
    if (sourceValue === null) {
      result.skippedForVault = true;
      continue;
    }
    if (destination.length === 1) {
      const destinationValue = vault.decryptItem(globalProjectId, destination[0]!.id);
      if (destinationValue !== sourceValue) {
        result.conflicts++;
        continue;
      }
      if (source.kind === "managed" && !rewriteMigratedManagedCredentialReference(
        globalProjectId,
        source.providerId,
        source.id,
        destination[0]!.id,
      )) {
        result.conflicts++;
        continue;
      }
      vault.deleteItem(source.projectId, source.id);
      result.migratedCredentials++;
      continue;
    }

    const destinationId = vault.createItem(globalProjectId, source.name, "api_key", sourceValue);
    if (!destinationId || destinationId === "Vault is sealed") {
      result.skippedForVault = true;
      continue;
    }
    if (vault.decryptItem(globalProjectId, destinationId) !== sourceValue) {
      vault.deleteItem(globalProjectId, destinationId);
      result.skippedForVault = true;
      continue;
    }
    if (source.kind === "managed" && !rewriteMigratedManagedCredentialReference(
      globalProjectId,
      source.providerId,
      source.id,
      destinationId,
    )) {
      vault.deleteItem(globalProjectId, destinationId);
      result.conflicts++;
      continue;
    }
    vault.deleteItem(source.projectId, source.id);
    result.migratedCredentials++;
  }
}

/** Move only unambiguous provider state from durably proven former-global projects. */
export function recoverServerGlobalProviderMetadata(): ProviderRecoveryResult {
  const result = emptyRecoveryResult();
  const globalProjectId = getCanonicalGlobalProjectId();
  if (!globalProjectId) {
    result.globalUnavailable = true;
    return result;
  }
  try {
    const sourceProjectIds = projects.getFormerGlobalProjectIds(globalProjectId);
    migrateProviderMetadata(globalProjectId, sourceProjectIds, result);
    migrateProviderCredentials(globalProjectId, sourceProjectIds, result);
    return result;
  } catch {
    return result;
  }
}

function managedProviderIds(projectId: string): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (isProviderId(value)) ids.add(value);
  };
  try {
    const raw = settings.getSetting(projectId, "llm_provider_configs");
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const provider of parsed) {
        if (provider && typeof provider === "object" && (provider as { enabled?: unknown }).enabled === true) {
          add((provider as { id?: unknown }).id);
        }
      }
    }
  } catch {
    // A malformed metadata setting is not a reason to guess a credential owner.
  }
  add(settings.getSetting(projectId, "synthesis_provider"));
  add(settings.getSetting(projectId, "synthesis_backup_provider"));
  return ids;
}

/** Restore API-key connections from the vault after OpenCode's native auth file is lost. */
export async function rehydrateServerGlobalProviderConnections(): Promise<ProviderRehydrationResult> {
  const result = emptyRehydrationResult();
  const globalProjectId = getCanonicalGlobalProjectId();
  if (!globalProjectId) {
    result.globalUnavailable = true;
    return result;
  }
  if (vault.isSealed()) {
    result.skippedForVault = true;
    return result;
  }

  const managedIds = managedProviderIds(globalProjectId);
  const candidates = listProviderCredentialItems(globalProjectId).filter((item) =>
    item.kind === "native" || managedIds.has(item.providerId),
  );
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}\u0000${candidate.providerId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const candidate of candidates) {
    if ((counts.get(`${candidate.kind}\u0000${candidate.providerId}`) ?? 0) !== 1) {
      result.failed++;
      continue;
    }
    const key = vault.decryptItem(globalProjectId, candidate.id);
    if (key === null) {
      result.failed++;
      continue;
    }
    const rehydrated = await callOpenCodeWithProviderDeadline((signal) =>
      opencodeClient.addAuth(candidate.providerId, { type: "api", key }, "/workspace", signal),
    );
    if (isOpenCodeError(rehydrated)) {
      result.failed++;
      continue;
    }
    result.restored++;
  }
  return result;
}

export async function reconcileServerGlobalProviderPersistence(): Promise<{
  migration: ProviderRecoveryResult;
  rehydration: ProviderRehydrationResult;
}> {
  return {
    migration: recoverServerGlobalProviderMetadata(),
    rehydration: await rehydrateServerGlobalProviderConnections(),
  };
}
