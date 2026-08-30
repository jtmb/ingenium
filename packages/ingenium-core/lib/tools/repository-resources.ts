/**
 * Repository-authoritative skills, agents, and plugins synchronization.
 *
 * The API receives a fully validated semantic manifest from the extension. It
 * never reads a caller's filesystem. The repository is authoritative, while
 * `repository_sync_resources` is the deletion boundary: an omitted resource is
 * changed only when a prior successful repository sync marked it as managed.
 */
import { createHash, randomUUID } from "node:crypto";
import { posix as path } from "node:path";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { isAgentCategory, isReservedAgentName, isSafeAgentName } from "./agents.js";
import { isSafeSkillName } from "./skills.js";

export const MAX_REPOSITORY_RESOURCE_ITEMS = 512;
export const MAX_REPOSITORY_RESOURCE_FILE_BYTES = 256 * 1024;
export const MAX_REPOSITORY_RESOURCE_TOTAL_BYTES = 1_500 * 1024;
const REPOSITORY_PLUGIN_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);
const REPOSITORY_PLUGIN_ROOTS = [".opencode/plugins/", "packages/"] as const;

type ResourceType = "skill" | "agent" | "plugin";

interface BaseEntry {
  identity: string;
  path: string;
  sha256: string;
}

export interface RepositorySkillEntry extends BaseEntry {
  name: string;
  skillMd: string;
  body: string;
  description: string;
  category?: string;
  tags: string[];
  alwaysApply: boolean;
  metadata: Record<string, unknown>;
  fileTree: Record<string, string>;
}

export interface RepositoryAgentEntry extends BaseEntry {
  name: string;
  category: string;
  frontmatter: string;
  body: string;
  description: string;
  mode: string;
  permissions: Record<string, unknown>;
  metadata: Record<string, unknown>;
  skills: string[];
  mirrors: string[];
  enabled: boolean;
}

export interface RepositoryPluginEntry extends BaseEntry {
  name: string;
  source: string;
  fileType: "regular";
  isSymlink: false;
  enabled: boolean;
  order: number | null;
  options: Record<string, unknown>;
}

export interface RepositoryResourcesManifest {
  version: 2;
  skills: RepositorySkillEntry[];
  agents: RepositoryAgentEntry[];
  plugins: RepositoryPluginEntry[];
}

export interface RepositoryResourcesSyncSummary {
  created: number;
  updated: number;
  renamed: number;
  archived: number;
  removed: number;
  unchanged: number;
}

export interface RepositoryResourcesSyncResult {
  dryRun: boolean;
  summary: Record<ResourceType, RepositoryResourcesSyncSummary>;
  confirmed: Array<{ type: ResourceType; identity: string; path: string; sha256: string }>;
}

export class RepositoryResourcesManifestError extends Error {
  constructor() {
    super("Repository resource manifest is invalid");
    this.name = "RepositoryResourcesManifestError";
  }
}

interface ManagedResource {
  project_id: string;
  resource_type: ResourceType;
  identity: string;
  resource_id: string;
  resource_name: string;
  source_path: string;
  source_hash: string;
  payload: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\u0000") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..") && path.normalize(value) === value;
}

function isSafeIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9:_-]{0,127}$/.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isStringArray(value: unknown, max = 128): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && item.length <= 512);
}

function isStringMap(value: unknown, max = 512): value is Record<string, string> {
  return isRecord(value) && Object.keys(value).length <= max && Object.entries(value).every(([key, item]) => isSafeRelativePath(key) && typeof item === "string");
}

function isSecretLikeRepositoryPath(value: string): boolean {
  return value.split("/").some((segment) => {
    const normalized = segment.toLowerCase();
    return normalized === ".env"
      || normalized.startsWith(".env.")
      || /(?:^|[._-])(?:secret|secrets|credential|credentials|token|tokens|password|passphrase|api[_-]?key|private[_-]?key|key|keys)(?:$|[._-])/.test(normalized);
  });
}

function isAllowedRepositoryPluginPath(value: string): boolean {
  return REPOSITORY_PLUGIN_ROOTS.some((root) => value.startsWith(root))
    && REPOSITORY_PLUGIN_EXTENSIONS.has(path.extname(value))
    && !isSecretLikeRepositoryPath(value);
}

function isSecretLikePluginOptionKey(key: string): boolean {
  const compact = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (new Set([
    "secret", "secrets", "credential", "credentials", "token", "tokens",
    "password", "passwords", "passphrase", "passphrases", "key", "keys",
    "apikey", "apikeys", "privatekey", "privatekeys", "accesstoken",
    "refreshtoken", "authtoken", "clientsecret",
  ]).has(compact)) return true;
  return /(?:secret|credential|token|password|passphrase)$/.test(compact)
    || /(?:^|[_-])key$/i.test(key)
    || /Key$/.test(key);
}

function containsSecretLikePluginOptionKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretLikePluginOptionKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => isSecretLikePluginOptionKey(key) || containsSecretLikePluginOptionKey(child));
}

function serializedSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && Buffer.byteLength(value) <= MAX_REPOSITORY_RESOURCE_FILE_BYTES;
}

function isBoundedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && serializedSize(value) <= MAX_REPOSITORY_RESOURCE_FILE_BYTES;
}

function assertEntrySize(entry: unknown, total: { bytes: number }): void {
  const bytes = serializedSize(entry);
  total.bytes += bytes;
  if (total.bytes > MAX_REPOSITORY_RESOURCE_TOTAL_BYTES) throw new RepositoryResourcesManifestError();
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function normalizedEntryHash(entry: Record<string, unknown>): string {
  return sha256(stable(entry));
}

function validateSkill(value: unknown, total: { bytes: number }): RepositorySkillEntry {
  if (!isRecord(value)
    || !isSafeIdentity(value.identity)
    || !isSafeRelativePath(value.path)
    || !value.path.startsWith(".opencode/skills/")
    || !isHash(value.sha256)
    || !isSafeSkillName(value.name)
    || !isBoundedText(value.skillMd)
    || !isBoundedText(value.body)
    || !isBoundedText(value.description)
    || (value.category !== undefined && !isBoundedText(value.category))
    || !isStringArray(value.tags)
    || typeof value.alwaysApply !== "boolean"
    || !isBoundedRecord(value.metadata)
    || !isStringMap(value.fileTree)) throw new RepositoryResourcesManifestError();
  for (const [filePath, content] of Object.entries(value.fileTree)) {
    if (filePath === "SKILL.md" || filePath === "metadata.json" || Buffer.byteLength(content) > MAX_REPOSITORY_RESOURCE_FILE_BYTES) {
      throw new RepositoryResourcesManifestError();
    }
  }
  const entry: RepositorySkillEntry = {
    identity: value.identity,
    path: value.path,
    sha256: value.sha256,
    name: value.name,
    skillMd: normalizeText(value.skillMd),
    body: normalizeText(value.body),
    description: value.description,
    category: value.category,
    tags: value.tags,
    alwaysApply: value.alwaysApply,
    metadata: value.metadata,
    fileTree: Object.fromEntries(Object.entries(value.fileTree).map(([filePath, content]) => [filePath, normalizeText(content)])),
  };
  const { sha256: _skillHash, identity: _skillIdentity, ...skillSemantic } = entry;
  if (entry.sha256 !== normalizedEntryHash(skillSemantic)) throw new RepositoryResourcesManifestError();
  assertEntrySize(entry, total);
  return entry;
}

function validateAgent(value: unknown, total: { bytes: number }): RepositoryAgentEntry {
  if (!isRecord(value)
    || !isSafeIdentity(value.identity)
    || !isSafeRelativePath(value.path)
    || !value.path.startsWith(".opencode/agents/")
    || !isHash(value.sha256)
    || !isSafeAgentName(value.name)
    || isReservedAgentName(value.name)
    || !isAgentCategory(value.category)
    || !isBoundedText(value.frontmatter)
    || !isBoundedText(value.body)
    || !isBoundedText(value.description)
    || !isBoundedText(value.mode)
    || !isBoundedRecord(value.permissions)
    || !isBoundedRecord(value.metadata)
    || !isStringArray(value.skills)
    || !isStringArray(value.mirrors)
    || !value.mirrors.every(isSafeRelativePath)
    || typeof value.enabled !== "boolean") throw new RepositoryResourcesManifestError();
  const entry: RepositoryAgentEntry = {
    identity: value.identity,
    path: value.path,
    sha256: value.sha256,
    name: value.name,
    category: value.category,
    frontmatter: normalizeText(value.frontmatter),
    body: normalizeText(value.body),
    description: value.description,
    mode: value.mode,
    permissions: value.permissions,
    metadata: value.metadata,
    skills: value.skills,
    mirrors: [...value.mirrors].sort(),
    enabled: value.enabled,
  };
  const { sha256: _agentHash, identity: _agentIdentity, ...agentSemantic } = entry;
  if (entry.sha256 !== normalizedEntryHash(agentSemantic)) throw new RepositoryResourcesManifestError();
  assertEntrySize(entry, total);
  return entry;
}

function validatePlugin(value: unknown, total: { bytes: number }): RepositoryPluginEntry {
  const order = isRecord(value) ? value.order : undefined;
  if (!isRecord(value)
    || !isSafeIdentity(value.identity)
    || !isSafeRelativePath(value.path)
    || !isAllowedRepositoryPluginPath(value.path)
    || !isHash(value.sha256)
    || !isSafeSkillName(value.name)
    || !isBoundedText(value.source)
    || value.fileType !== "regular"
    || value.isSymlink !== false
    || typeof value.enabled !== "boolean"
    || (order !== null && (typeof order !== "number" || !Number.isInteger(order) || order < 0))
    || !isBoundedRecord(value.options)
    || containsSecretLikePluginOptionKey(value.options)) throw new RepositoryResourcesManifestError();
  const pluginOrder = order as number | null;
  const entry: RepositoryPluginEntry = {
    identity: value.identity,
    path: value.path,
    sha256: value.sha256,
    name: value.name,
    source: normalizeText(value.source),
    fileType: "regular",
    isSymlink: false,
    enabled: value.enabled,
    order: pluginOrder,
    options: value.options,
  };
  const { sha256: _pluginHash, identity: _pluginIdentity, ...pluginSemantic } = entry;
  if (entry.sha256 !== normalizedEntryHash(pluginSemantic)) throw new RepositoryResourcesManifestError();
  assertEntrySize(entry, total);
  return entry;
}

function validateManifest(value: unknown): RepositoryResourcesManifest {
  const allowedKeys = ["version", "skills", "agents", "plugins"];
  if (!isRecord(value) || Object.keys(value).length !== allowedKeys.length || !Object.keys(value).every((key) => allowedKeys.includes(key))
    || value.version !== 2 || !Array.isArray(value.skills) || !Array.isArray(value.agents) || !Array.isArray(value.plugins)) {
    throw new RepositoryResourcesManifestError();
  }
  const count = value.skills.length + value.agents.length + value.plugins.length;
  if (count > MAX_REPOSITORY_RESOURCE_ITEMS) throw new RepositoryResourcesManifestError();
  const total = { bytes: 0 };
  const skills = value.skills.map((entry) => validateSkill(entry, total));
  const agents = value.agents.map((entry) => validateAgent(entry, total));
  const plugins = value.plugins.map((entry) => validatePlugin(entry, total));
  for (const entries of [skills, agents, plugins]) {
    const identities = new Set<string>();
    const names = new Set<string>();
    for (const entry of entries) {
      if (identities.has(entry.identity) || names.has(entry.name)) throw new RepositoryResourcesManifestError();
      identities.add(entry.identity);
      names.add(entry.name);
    }
  }
  return { version: 2, skills, agents, plugins };
}

export function validateRepositoryResourcesManifest(value: unknown): RepositoryResourcesManifest {
  return validateManifest(value);
}

function emptySummary(): RepositoryResourcesSyncSummary {
  return { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 };
}

function resourceRows(projectId: string, type: ResourceType): ManagedResource[] {
  return getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(
    "SELECT * FROM repository_sync_resources WHERE project_id = ? AND resource_type = ? ORDER BY identity",
  ).all(projectId, type) as ManagedResource[];
}

function resourceExists(db: ReturnType<typeof getDb>, type: ResourceType, projectId: string, resourceId: string): boolean {
  const table = type === "skill" ? "skills" : type === "agent" ? "agents" : "plugins";
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE project_id = ? AND id = ?`).get(projectId, resourceId));
}

function upsertState(db: ReturnType<typeof getDb>, projectId: string, type: ResourceType, entry: BaseEntry & { name: string }, resourceId: string, payload: unknown): void {
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO repository_sync_resources
      (project_id, resource_type, identity, resource_id, resource_name, source_path, source_hash, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, resource_type, identity) DO UPDATE SET
       resource_id = excluded.resource_id, resource_name = excluded.resource_name,
       source_path = excluded.source_path, source_hash = excluded.source_hash,
       payload = excluded.payload, updated_at = excluded.updated_at`,
  ).run(projectId, type, entry.identity, resourceId, entry.name, entry.path, entry.sha256, JSON.stringify(payload), timestamp, timestamp);
}

function adoptManagedIdentity(
  db: ReturnType<typeof getDb>,
  projectId: string,
  type: ResourceType,
  entry: BaseEntry & { name: string },
  managed: Map<string, ManagedResource>,
  dryRun: boolean,
): ManagedResource | undefined {
  const exact = managed.get(entry.identity);
  if (exact) return exact;
  const matches = [...managed.values()].filter((state) => state.resource_name === entry.name);
  if (matches.length !== 1) return undefined;

  const previous = matches[0]!;
  if (!dryRun) {
    db.prepare("UPDATE repository_sync_resources SET identity = ? WHERE project_id = ? AND resource_type = ? AND identity = ?")
      .run(entry.identity, projectId, type, previous.identity);
  }
  const adopted = { ...previous, identity: entry.identity };
  managed.delete(previous.identity);
  managed.set(entry.identity, adopted);
  return adopted;
}

function syncSkillsInTransaction(projectId: string, entries: RepositorySkillEntry[], dryRun: boolean): { summary: RepositoryResourcesSyncSummary; confirmed: RepositoryResourcesSyncResult["confirmed"] } {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const summary = emptySummary();
  const confirmed: RepositoryResourcesSyncResult["confirmed"] = [];
  const managed = new Map(resourceRows(projectId, "skill").map((row) => [row.identity, row]));
  const incoming = new Set(entries.map((entry) => entry.identity));
  const timestamp = new Date().toISOString();

  for (const entry of entries) {
    const state = adoptManagedIdentity(db, projectId, "skill", entry, managed, dryRun);
    const current = state && resourceExists(db, "skill", projectId, state.resource_id)
      ? db.prepare("SELECT * FROM skills WHERE id = ?").get(state.resource_id) as { id: string; name: string; description: string; content: string; category: string | null; tags: string | null; always_apply: number; file_tree: string | null; archived_at: string | null } | undefined
      : db.prepare("SELECT * FROM skills WHERE project_id = ? AND name = ?").get(projectId, entry.name) as { id: string; name: string; description: string; content: string; category: string | null; tags: string | null; always_apply: number; file_tree: string | null; archived_at: string | null } | undefined;
    const tags = entry.tags.join(",");
    const fileTree = JSON.stringify(entry.fileTree);
    if (!current) {
      summary.created++;
      if (!dryRun) {
        const id = randomUUID();
        db.prepare(`INSERT INTO skills (id, project_id, name, description, content, category, tags, always_apply, file_tree, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .run(id, projectId, entry.name, entry.description, entry.body, entry.category ?? null, tags, entry.alwaysApply ? 1 : 0, fileTree, timestamp, timestamp);
        upsertState(db, projectId, "skill", entry, id, entry);
      }
    } else {
      const changed = current.name !== entry.name || current.description !== entry.description || current.content !== entry.body
        || current.category !== (entry.category ?? null) || (current.tags ?? "") !== tags
        || (current.always_apply ?? 0) !== (entry.alwaysApply ? 1 : 0) || (current.file_tree ?? "") !== fileTree || current.archived_at !== null;
      if (!changed && state?.source_hash === entry.sha256 && state.source_path === entry.path) summary.unchanged++;
      else if (current.name !== entry.name) summary.renamed++;
      else summary.updated++;
      if (!dryRun) {
        if (changed) db.prepare(`UPDATE skills SET name=?, description=?, content=?, category=?, tags=?, always_apply=?, file_tree=?, archived_at=NULL, revision=revision+1, updated_at=? WHERE id=?`)
          .run(entry.name, entry.description, entry.body, entry.category ?? null, tags, entry.alwaysApply ? 1 : 0, fileTree, timestamp, current.id);
        upsertState(db, projectId, "skill", entry, current.id, entry);
      }
    }
    confirmed.push({ type: "skill", identity: entry.identity, path: entry.path, sha256: entry.sha256 });
  }

  for (const [identity, state] of managed) {
    if (incoming.has(identity)) continue;
    summary.archived++;
    if (!dryRun) {
      db.prepare("UPDATE skills SET archived_at = COALESCE(archived_at, ?), revision = revision + 1, updated_at = ? WHERE id = ? AND project_id = ?")
        .run(timestamp, timestamp, state.resource_id, projectId);
      db.prepare("DELETE FROM repository_sync_resources WHERE project_id = ? AND resource_type = 'skill' AND identity = ?").run(projectId, identity);
    }
  }
  return { summary, confirmed };
}

function syncAgentsInTransaction(projectId: string, entries: RepositoryAgentEntry[], dryRun: boolean): { summary: RepositoryResourcesSyncSummary; confirmed: RepositoryResourcesSyncResult["confirmed"] } {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const summary = emptySummary();
  const confirmed: RepositoryResourcesSyncResult["confirmed"] = [];
  const managed = new Map(resourceRows(projectId, "agent").map((row) => [row.identity, row]));
  const incoming = new Set(entries.map((entry) => entry.identity));
  const timestamp = new Date().toISOString();

  for (const entry of entries) {
    const state = adoptManagedIdentity(db, projectId, "agent", entry, managed, dryRun);
    const current = state && resourceExists(db, "agent", projectId, state.resource_id)
      ? db.prepare("SELECT * FROM agents WHERE id = ?").get(state.resource_id) as { id: string; name: string; description: string; category: string; mode: string; permissions: string; metadata: string; skills: string; content: string; enabled: number } | undefined
      : db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?").get(projectId, entry.name) as { id: string; name: string; description: string; category: string; mode: string; permissions: string; metadata: string; skills: string; content: string; enabled: number } | undefined;
    const permissions = JSON.stringify(entry.permissions);
    const metadata = JSON.stringify(entry.metadata);
    const skills = JSON.stringify(entry.skills);
    if (!current) {
      summary.created++;
      if (!dryRun) {
        const id = randomUUID();
        db.prepare(`INSERT INTO agents (id, project_id, name, description, category, mode, permissions, metadata, skills, content, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, projectId, entry.name, entry.description, entry.category, entry.mode, permissions, metadata, skills, entry.body, entry.enabled ? 1 : 0, timestamp, timestamp);
        upsertState(db, projectId, "agent", entry, id, entry);
      }
    } else {
      const changed = current.name !== entry.name || current.description !== entry.description || current.category !== entry.category
        || current.mode !== entry.mode || current.permissions !== permissions || current.metadata !== metadata
        || current.skills !== skills || current.content !== entry.body || current.enabled !== (entry.enabled ? 1 : 0);
      if (!changed && state?.source_hash === entry.sha256 && state.source_path === entry.path) summary.unchanged++;
      else if (current.name !== entry.name) summary.renamed++;
      else summary.updated++;
      if (!dryRun) {
        if (changed) db.prepare(`UPDATE agents SET name=?, description=?, category=?, mode=?, permissions=?, metadata=?, skills=?, content=?, enabled=?, updated_at=? WHERE id=?`)
          .run(entry.name, entry.description, entry.category, entry.mode, permissions, metadata, skills, entry.body, entry.enabled ? 1 : 0, timestamp, current.id);
        upsertState(db, projectId, "agent", entry, current.id, entry);
      }
    }
    confirmed.push({ type: "agent", identity: entry.identity, path: entry.path, sha256: entry.sha256 });
  }

  for (const [identity, state] of managed) {
    if (incoming.has(identity)) continue;
    summary.removed++;
    if (!dryRun) {
      db.prepare("DELETE FROM agents WHERE id = ? AND project_id = ? AND name <> 'ingenium-llm-broker'").run(state.resource_id, projectId);
      db.prepare("DELETE FROM repository_sync_resources WHERE project_id = ? AND resource_type = 'agent' AND identity = ?").run(projectId, identity);
    }
  }
  return { summary, confirmed };
}

function syncPluginsInTransaction(projectId: string, entries: RepositoryPluginEntry[], dryRun: boolean): { summary: RepositoryResourcesSyncSummary; confirmed: RepositoryResourcesSyncResult["confirmed"] } {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const summary = emptySummary();
  const confirmed: RepositoryResourcesSyncResult["confirmed"] = [];
  const managed = new Map(resourceRows(projectId, "plugin").map((row) => [row.identity, row]));
  const incoming = new Set(entries.map((entry) => entry.identity));
  const timestamp = new Date().toISOString();

  for (const entry of entries) {
    const state = adoptManagedIdentity(db, projectId, "plugin", entry, managed, dryRun);
    const current = state && resourceExists(db, "plugin", projectId, state.resource_id)
      ? db.prepare("SELECT * FROM plugins WHERE id = ?").get(state.resource_id) as { id: string; name: string; file_path: string; source_content: string | null; enabled: number } | undefined
      : db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?").get(projectId, entry.name) as { id: string; name: string; file_path: string; source_content: string | null; enabled: number } | undefined;
    if (!current) {
      summary.created++;
      if (!dryRun) {
        const id = `plugin_${randomUUID()}`;
        db.prepare(`INSERT INTO plugins (id, project_id, name, file_path, enabled, source_content, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, projectId, entry.name, entry.path, entry.enabled ? 1 : 0, entry.source, timestamp, timestamp);
        upsertState(db, projectId, "plugin", entry, id, entry);
      }
    } else {
      const changed = current.name !== entry.name || current.file_path !== entry.path || (current.source_content ?? "") !== entry.source || current.enabled !== (entry.enabled ? 1 : 0);
      if (!changed && state?.source_hash === entry.sha256 && state.source_path === entry.path) summary.unchanged++;
      else if (current.name !== entry.name) summary.renamed++;
      else summary.updated++;
      if (!dryRun) {
        if (changed) db.prepare("UPDATE plugins SET name=?, file_path=?, source_content=?, enabled=?, updated_at=? WHERE id=?")
          .run(entry.name, entry.path, entry.source, entry.enabled ? 1 : 0, timestamp, current.id);
        upsertState(db, projectId, "plugin", entry, current.id, entry);
      }
    }
    confirmed.push({ type: "plugin", identity: entry.identity, path: entry.path, sha256: entry.sha256 });
  }

  for (const [identity, state] of managed) {
    if (incoming.has(identity)) continue;
    summary.removed++;
    if (!dryRun) {
      db.prepare("DELETE FROM plugins WHERE id = ? AND project_id = ?").run(state.resource_id, projectId);
      db.prepare("DELETE FROM repository_sync_resources WHERE project_id = ? AND resource_type = 'plugin' AND identity = ?").run(projectId, identity);
    }
  }
  return { summary, confirmed };
}

/** Preview or apply all non-document repository resources atomically. */
export function syncRepositoryResources(projectId: string, input: unknown, dryRun = false): RepositoryResourcesSyncResult {
  if (dryRun) return syncRepositoryResourcesInTransaction(projectId, input, true);
  const result = execTransaction(() => syncRepositoryResourcesInTransaction(projectId, input, false));
  if (result.confirmed.length > 0) checkpointAfterWrite();
  return result;
}

export function syncRepositoryResourcesInTransaction(projectId: string, input: unknown, dryRun = false): RepositoryResourcesSyncResult {
  const manifest = validateManifest(input);
  const skills = syncSkillsInTransaction(projectId, manifest.skills, dryRun);
  const agents = syncAgentsInTransaction(projectId, manifest.agents, dryRun);
  const plugins = syncPluginsInTransaction(projectId, manifest.plugins, dryRun);
  return {
    dryRun,
    summary: { skill: skills.summary, agent: agents.summary, plugin: plugins.summary },
    confirmed: [...skills.confirmed, ...agents.confirmed, ...plugins.confirmed],
  };
}
