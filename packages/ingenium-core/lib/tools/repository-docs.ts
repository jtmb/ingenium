/**
 * Repository-authoritative Docs Workspace onboarding.
 *
 * This module accepts a verified manifest; it never opens repository paths.
 * The extension owns filesystem walking and must submit only regular Markdown
 * files. Treating the manifest as data keeps the API process isolated from a
 * caller's filesystem while still enforcing path, hash, size, and secret gates.
 */

import { createHash } from "node:crypto";
import { posix as path } from "node:path";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { isValidProjectName } from "./projects.js";
import {
  REPOSITORY_DOC_RAG_TAGS,
  repositoryDocRagSourcePath,
  upsertRepositoryDocSourceInTransaction,
} from "./rag.js";

export const MAX_REPOSITORY_DOC_FILES = 256;
export const MAX_REPOSITORY_DOC_FILE_BYTES = 512 * 1024;
export const MAX_REPOSITORY_DOC_TOTAL_BYTES = 1_500 * 1024;
export const REPOSITORY_DOC_PAGE_TAGS = ["repository-managed", "repository-doc"] as const;

export interface RepositoryDocsManifestEntry {
  path: string;
  sha256: string;
  content: string;
  fileType: "regular";
  isSymlink: false;
}

export interface RepositoryDocsManifest {
  files: RepositoryDocsManifestEntry[];
}

export type RepositoryDocsOperationKind = "created" | "updated" | "renamed" | "restored" | "archived" | "unchanged";

export interface RepositoryDocsOperation {
  kind: RepositoryDocsOperationKind;
  sourcePath: string;
  previousSourcePath?: string;
  pageId?: number;
}

export interface RepositoryDocsSyncSummary {
  created: number;
  updated: number;
  renamed: number;
  restored: number;
  archived: number;
  unchanged: number;
  ragCreated: number;
  ragUpdated: number;
  ragDeleted: number;
  spaceCreated: number;
  spaceRepaired: number;
}

export type RepositoryDocsSpaceAction = "created" | "repaired" | "unchanged" | "none";

export interface RepositoryDocsSpaceResult {
  action: RepositoryDocsSpaceAction;
  id?: number;
  name: string;
  slug: string;
}

export interface RepositoryDocsSyncResult {
  dryRun: boolean;
  summary: RepositoryDocsSyncSummary;
  space: RepositoryDocsSpaceResult;
  operations: RepositoryDocsOperation[];
}

/** Deliberately generic: callers must never receive document contents or paths in an error. */
export class RepositoryDocsManifestError extends Error {
  constructor() {
    super("Repository documentation manifest is invalid");
    this.name = "RepositoryDocsManifestError";
  }
}

/** The caller's project ID did not resolve to a valid persisted project name. */
export class RepositoryDocsProjectError extends Error {
  constructor() {
    super("Repository documentation project is unavailable");
    this.name = "RepositoryDocsProjectError";
  }
}

/** A canonical repository space name or slug belongs to another Docs space. */
export class RepositoryDocsSpaceConflictError extends Error {
  constructor() {
    super("Repository documentation space conflicts with an existing space");
    this.name = "RepositoryDocsSpaceConflictError";
  }
}

interface ManagedRepositoryPage {
  page_id: number;
  project_id: string;
  source_path: string;
  source_hash: string;
  rag_source_id: string | null;
  managed_tags: string;
  space_id: number;
  parent_page_id: number | null;
  title: string;
  slug: string;
  content: string;
  revision: number;
  status: "draft" | "published" | "archived";
  rag_project_id: string | null;
  rag_source_hash: string | null;
  rag_title: string | null;
  rag_source_path: string | null;
  rag_source_type: string | null;
  rag_metadata: string | null;
}

interface PlannedDocument {
  entry: RepositoryDocsManifestEntry;
  title: string;
  existing?: ManagedRepositoryPage;
  kind: Exclude<RepositoryDocsOperationKind, "archived">;
  previousSourcePath?: string;
  sourceNeedsRepair: boolean;
  relationshipChanged: boolean;
}

interface SyncPlan {
  active: PlannedDocument[];
  archived: ManagedRepositoryPage[];
  space: RepositoryDocsSpacePlan;
}

interface RepositoryDocsSpace {
  id: number;
  name: string;
  slug: string;
}

interface RepositoryDocsSpacePlan {
  action: RepositoryDocsSpaceAction;
  name: string;
  slug: string;
  existing?: RepositoryDocsSpace;
}

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isSafeRepositoryDocPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 9 || value.length > 512) return false;
  if (!value.startsWith("docs/") || !value.endsWith(".md") || value.includes("\\") || value.includes("\u0000")) return false;
  if (value.includes("//") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const segments = value.split("/");
  if (segments.length < 2 || segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  return path.normalize(value) === value;
}

function hasLikelySecret(content: string): boolean {
  // The scanner intentionally favors safety over ingestion. It detects common
  // credential formats and high-entropy secret assignments, while allowing
  // documentation placeholders such as <YOUR_API_TOKEN>.
  const patterns = [
    /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/,
    /\b(?:sk|rk)_[A-Za-z0-9]{20,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\b(?:api[_-]?(?:key|token)|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_+\/=.-]{24,}/i,
  ];
  return patterns.some((pattern) => pattern.test(content));
}

function validateManifest(value: unknown): RepositoryDocsManifest {
  if (!isRecord(value) || !hasExactlyKeys(value, ["files"]) || !Array.isArray(value.files)) {
    throw new RepositoryDocsManifestError();
  }
  if (value.files.length > MAX_REPOSITORY_DOC_FILES) throw new RepositoryDocsManifestError();

  const files: RepositoryDocsManifestEntry[] = [];
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const entry of value.files) {
    if (!isRecord(entry) || !hasExactlyKeys(entry, ["path", "sha256", "content", "fileType", "isSymlink"])) {
      throw new RepositoryDocsManifestError();
    }
    if (!isSafeRepositoryDocPath(entry.path)
      || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || typeof entry.content !== "string"
      || entry.fileType !== "regular"
      || entry.isSymlink !== false
      || paths.has(entry.path)) {
      throw new RepositoryDocsManifestError();
    }
    const byteLength = Buffer.byteLength(entry.content);
    if (byteLength > MAX_REPOSITORY_DOC_FILE_BYTES || hasLikelySecret(entry.content)) {
      throw new RepositoryDocsManifestError();
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_REPOSITORY_DOC_TOTAL_BYTES || sha256(entry.content) !== entry.sha256) {
      throw new RepositoryDocsManifestError();
    }
    paths.add(entry.path);
    files.push({
      path: entry.path,
      sha256: entry.sha256,
      content: entry.content,
      fileType: "regular",
      isSymlink: false,
    });
  }
  return { files };
}

/** Validate a manifest before dry-run or apply. Exposed for extension/API tests. */
export function validateRepositoryDocsManifest(value: unknown): RepositoryDocsManifest {
  return validateManifest(value);
}

function deriveTitle(entry: RepositoryDocsManifestEntry): string {
  const heading = entry.content.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1]
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  if (heading) return heading.slice(0, 240);

  const name = path.basename(entry.path, ".md").replace(/[-_]+/g, " ").trim();
  return (name || "Repository documentation").slice(0, 240);
}

function expectedMetadata(projectId: string, pageId: number, entry: RepositoryDocsManifestEntry): string {
  return JSON.stringify({
    kind: "repository_doc",
    managed: true,
    identity: "repository-doc-v1",
    projectId,
    pageId,
    repositoryPath: entry.path,
    repositoryHash: entry.sha256,
    managedTags: [...REPOSITORY_DOC_RAG_TAGS],
    provenance: "repository-manifest",
  });
}

function getManagedPages(db: ReturnType<typeof getDb>, projectId: string): ManagedRepositoryPage[] {
  return db.prepare(
    `SELECT rp.*, p.space_id, p.parent_page_id, p.title, p.slug, p.content, p.revision, p.status,
            rs.project_id AS rag_project_id, rs.source_hash AS rag_source_hash, rs.title AS rag_title,
            rs.source_path AS rag_source_path, rs.source_type AS rag_source_type, rs.metadata AS rag_metadata
     FROM docs_repository_pages rp
     INNER JOIN docs_pages p ON p.id = rp.page_id
     LEFT JOIN rag_sources rs ON rs.id = rp.rag_source_id
     WHERE rp.project_id = ?
     ORDER BY rp.page_id`,
  ).all(projectId) as ManagedRepositoryPage[];
}

function hasManagedPageTags(db: ReturnType<typeof getDb>, pageId: number): boolean {
  const count = db.prepare(
    `SELECT count(*) AS count
     FROM docs_page_tags pt
     INNER JOIN docs_tags t ON t.id = pt.tag_id
     WHERE pt.page_id = ? AND t.name IN (?, ?)`,
  ).get(pageId, ...REPOSITORY_DOC_PAGE_TAGS) as { count: number };
  return count.count === REPOSITORY_DOC_PAGE_TAGS.length;
}

function hasProjectLink(db: ReturnType<typeof getDb>, pageId: number, projectId: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM docs_page_projects WHERE page_id = ? AND project_id = ?",
  ).get(pageId, projectId));
}

function sourceNeedsRepair(
  existing: ManagedRepositoryPage,
  projectId: string,
  title: string,
  entry: RepositoryDocsManifestEntry,
): boolean {
  return existing.rag_source_id === null
    || existing.rag_project_id !== projectId
    || existing.rag_source_hash !== entry.sha256
    || existing.rag_title !== title
    || existing.rag_source_path !== repositoryDocRagSourcePath(projectId, existing.page_id)
    || existing.rag_source_type !== "file"
    || existing.rag_metadata !== expectedMetadata(projectId, existing.page_id, entry);
}

function parentPathFor(sourcePath: string, activePaths: Set<string>): string | null {
  const candidate = `${path.dirname(sourcePath)}/index.md`;
  return candidate !== sourcePath && activePaths.has(candidate) ? candidate : null;
}

function resolveRepositoryProjectNameInTransaction(db: ReturnType<typeof getDb>, projectId: string): string {
  const project = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  if (!project || !isValidProjectName(project.name)) throw new RepositoryDocsProjectError();
  return project.name;
}

function buildRepositorySpacePlan(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  projectName: string,
  managedPages: ManagedRepositoryPage[],
  hasNewPages: boolean,
): RepositoryDocsSpacePlan {
  const name = projectName;
  const slug = `repository-${projectName}`;
  const managedSpaceIds = [...new Set(managedPages.map((page) => page.space_id))];
  if (managedSpaceIds.length > 1) throw new RepositoryDocsSpaceConflictError();

  if (managedSpaceIds.length === 1) {
    const existing = db.prepare("SELECT id, name, slug FROM docs_spaces WHERE id = ?")
      .get(managedSpaceIds[0]) as RepositoryDocsSpace | undefined;
    if (!existing) throw new RepositoryDocsSpaceConflictError();

    const collision = db.prepare(
      "SELECT id FROM docs_spaces WHERE organization_id = ? AND (name = ? OR slug = ?) AND id <> ? LIMIT 1",
    ).get(organizationId, name, slug, existing.id);
    if (collision) throw new RepositoryDocsSpaceConflictError();

    return {
      action: existing.name === name && existing.slug === slug ? "unchanged" : "repaired",
      name,
      slug,
      existing,
    };
  }

  if (!hasNewPages) return { action: "none", name, slug };

  const collision = db.prepare("SELECT id FROM docs_spaces WHERE organization_id = ? AND (name = ? OR slug = ?) LIMIT 1").get(organizationId, name, slug);
  if (collision) throw new RepositoryDocsSpaceConflictError();
  return { action: "created", name, slug };
}

function buildPlan(db: ReturnType<typeof getDb>, projectId: string, manifest: RepositoryDocsManifest): SyncPlan {
  const organization = db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string } | undefined;
  if (!organization) throw new RepositoryDocsProjectError();
  const projectName = resolveRepositoryProjectNameInTransaction(db, projectId);
  const existing = getManagedPages(db, projectId);
  const existingByPath = new Map(existing.map((record) => [record.source_path, record]));
  const activePaths = new Set(manifest.files.map((file) => file.path));
  const hashCounts = new Map<string, number>();
  for (const file of manifest.files) hashCounts.set(file.sha256, (hashCounts.get(file.sha256) ?? 0) + 1);

  const claimedPageIds = new Set<number>();
  const active: PlannedDocument[] = [];
  for (const entry of [...manifest.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const title = deriveTitle(entry);
    let record = existingByPath.get(entry.path);
    let kind: PlannedDocument["kind"];
    let previousSourcePath: string | undefined;

    if (record) {
      claimedPageIds.add(record.page_id);
      if (record.status === "archived") kind = "restored";
      else if (record.source_hash !== entry.sha256 || record.content !== entry.content || record.title !== title) kind = "updated";
      else kind = "unchanged";
    } else {
      const renameCandidates = hashCounts.get(entry.sha256) === 1
        ? existing.filter((candidate) => candidate.source_hash === entry.sha256
          && !activePaths.has(candidate.source_path)
          && !claimedPageIds.has(candidate.page_id))
        : [];
      if (renameCandidates.length === 1) {
        record = renameCandidates[0]!;
        claimedPageIds.add(record.page_id);
        kind = "renamed";
        previousSourcePath = record.source_path;
      } else {
        kind = "created";
      }
    }

    const needsRepair = record
      ? sourceNeedsRepair(record, projectId, title, entry)
        || !hasManagedPageTags(db, record.page_id)
        || !hasProjectLink(db, record.page_id, projectId)
      : true;
    active.push({ entry, title, existing: record, kind, previousSourcePath, sourceNeedsRepair: needsRepair, relationshipChanged: false });
  }

  const activeByPath = new Map(active.map((planned) => [planned.entry.path, planned]));
  for (const planned of active) {
    const parentPath = parentPathFor(planned.entry.path, activePaths);
    const parent = parentPath ? activeByPath.get(parentPath) : undefined;
    const desiredParentId = parent?.existing?.page_id ?? null;
    const parentWillBeCreated = Boolean(parent && !parent.existing);
    if (!planned.existing) {
      planned.relationshipChanged = Boolean(parent);
    } else if (parentWillBeCreated || planned.existing.parent_page_id !== desiredParentId) {
      planned.relationshipChanged = true;
    }
    if (planned.kind === "unchanged" && (planned.sourceNeedsRepair || planned.relationshipChanged)) {
      planned.kind = "updated";
    }
  }

  const archived = existing.filter((record) => !claimedPageIds.has(record.page_id)
    && (record.status !== "archived" || record.rag_source_id !== null));
  return {
    active,
    archived,
    space: buildRepositorySpacePlan(db, organization.organization_id, projectName, existing, active.some((planned) => !planned.existing)),
  };
}

function emptySummary(): RepositoryDocsSyncSummary {
  return {
    created: 0,
    updated: 0,
    renamed: 0,
    restored: 0,
    archived: 0,
    unchanged: 0,
    ragCreated: 0,
    ragUpdated: 0,
    ragDeleted: 0,
    spaceCreated: 0,
    spaceRepaired: 0,
  };
}

function resultForPlan(plan: SyncPlan, dryRun: boolean): RepositoryDocsSyncResult {
  const summary = emptySummary();
  const operations: RepositoryDocsOperation[] = [];
  if (plan.space.action === "created") summary.spaceCreated++;
  if (plan.space.action === "repaired") summary.spaceRepaired++;
  for (const planned of plan.active) {
    summary[planned.kind]++;
    operations.push({
      kind: planned.kind,
      sourcePath: planned.entry.path,
      previousSourcePath: planned.previousSourcePath,
      pageId: planned.existing?.page_id,
    });
    if (planned.kind === "created") summary.ragCreated++;
    else if (planned.kind !== "unchanged") {
      if (planned.existing?.rag_source_id) summary.ragUpdated++;
      else summary.ragCreated++;
    }
  }
  for (const archived of plan.archived) {
    summary.archived++;
    if (archived.rag_source_id) summary.ragDeleted++;
    operations.push({ kind: "archived", sourcePath: archived.source_path, pageId: archived.page_id });
  }
  return {
    dryRun,
    summary,
    space: {
      action: plan.space.action,
      id: plan.space.existing?.id,
      name: plan.space.name,
      slug: plan.space.slug,
    },
    operations,
  };
}

function reconcileRepositorySpaceInTransaction(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  space: RepositoryDocsSpacePlan,
  timestamp: string,
): number | undefined {
  if (space.action === "none") return undefined;

  if (space.existing) {
    if (space.action === "repaired") {
      db.prepare("UPDATE docs_spaces SET name = ?, slug = ?, updated_at = ? WHERE id = ?")
        .run(space.name, space.slug, timestamp, space.existing.id);
    }
    return space.existing.id;
  }

  const insert = db.prepare(
    `INSERT INTO docs_spaces (organization_id, name, slug, description, icon, sort_order, is_global, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'folder', 0, 0, ?, ?)`,
  ).run(organizationId, space.name, space.slug, "Repository-authoritative documentation", timestamp, timestamp);
  return Number(insert.lastInsertRowid);
}

function initialSlugInTransaction(db: ReturnType<typeof getDb>, sourcePath: string): string {
  const base = `repository-${sha256(sourcePath).slice(0, 32)}`;
  let candidate = base;
  let suffix = 1;
  while (db.prepare("SELECT 1 FROM docs_pages WHERE slug = ?").get(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function ensureManagedTagsInTransaction(db: ReturnType<typeof getDb>, pageId: number): void {
  // The page was created/loaded in this transaction, and tag rows are resolved
  // before linking, satisfying the parent-existence guard for this FK child row.
  for (const name of REPOSITORY_DOC_PAGE_TAGS) {
    const page = db.prepare("SELECT organization_id FROM docs_pages WHERE id = ?").get(pageId) as { organization_id: string };
    db.prepare("INSERT INTO docs_tags (organization_id, name, slug) VALUES (?, ?, ?) ON CONFLICT(organization_id, slug) DO NOTHING").run(page.organization_id, name, name);
    const tag = db.prepare("SELECT id FROM docs_tags WHERE slug = ? AND organization_id = ?").get(name, page.organization_id) as { id: number } | undefined;
    if (!tag) throw new Error("Managed documentation tag is unavailable");
    db.prepare(
      "INSERT INTO docs_page_tags (organization_id, page_id, tag_id) VALUES (?, ?, ?) ON CONFLICT(page_id, tag_id) DO NOTHING",
    ).run(page.organization_id, pageId, tag.id);
  }
}

function ensureProjectLinkInTransaction(db: ReturnType<typeof getDb>, pageId: number, projectId: string): void {
  const project = db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId);
  const page = db.prepare("SELECT 1 FROM docs_pages WHERE id = ?").get(pageId);
  if (!project || !page) throw new Error("Managed documentation parent is unavailable");
  db.prepare(
    "INSERT INTO docs_page_projects (organization_id, page_id, project_id) SELECT organization_id, ?, ? FROM projects WHERE id = ? ON CONFLICT(page_id, project_id) DO NOTHING",
  ).run(pageId, projectId, projectId);
}

function applyPlanInTransaction(projectId: string, plan: SyncPlan): RepositoryDocsSyncResult {
  const db = getDb(dbPath());
  const result = resultForPlan(plan, false);
  const timestamp = now();
  const organization = db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string } | undefined;
  if (!organization) throw new RepositoryDocsProjectError();
  const organizationId = organization.organization_id;
  const spaceId = reconcileRepositorySpaceInTransaction(db, organizationId, plan.space, timestamp);
  if (spaceId !== undefined) result.space.id = spaceId;
  const resolvedPages = new Map<string, ManagedRepositoryPage>();

  for (const planned of plan.active) {
    let record = planned.existing;
    let pageId: number;
    let wasRestored = false;
    let contentChanged = false;

    if (!record) {
      if (spaceId === undefined) throw new Error("Repository documentation space is unavailable");
      const insert = db.prepare(
        `INSERT INTO docs_pages
         (organization_id, space_id, parent_page_id, title, slug, content, revision, status, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, 1, 'published', 0, ?, ?)`,
      ).run(organizationId, spaceId!, planned.title, initialSlugInTransaction(db, planned.entry.path), planned.entry.content, timestamp, timestamp);
      pageId = Number(insert.lastInsertRowid);
      db.prepare(
        "INSERT INTO docs_page_versions (organization_id, page_id, revision, title, content, created_at) VALUES (?, ?, 1, ?, ?, ?)",
      ).run(organizationId, pageId, planned.title, planned.entry.content, timestamp);
      record = {
        page_id: pageId, project_id: projectId, source_path: planned.entry.path, source_hash: planned.entry.sha256,
        rag_source_id: null, managed_tags: JSON.stringify(REPOSITORY_DOC_PAGE_TAGS), space_id: spaceId!, parent_page_id: null,
        title: planned.title, slug: "", content: planned.entry.content, revision: 1, status: "published",
        rag_project_id: null, rag_source_hash: null, rag_title: null, rag_source_path: null, rag_source_type: null, rag_metadata: null,
      };
      db.prepare(
        `INSERT INTO docs_repository_pages
         (organization_id, page_id, project_id, source_path, source_hash, rag_source_id, managed_tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(organizationId, pageId, projectId, planned.entry.path, planned.entry.sha256, JSON.stringify(REPOSITORY_DOC_PAGE_TAGS), timestamp, timestamp);
      contentChanged = true;
    } else {
      pageId = record.page_id;
      wasRestored = record.status === "archived";
      contentChanged = record.content !== planned.entry.content || record.source_hash !== planned.entry.sha256;
      if (contentChanged) {
        const nextRevision = record.revision + 1;
        db.prepare(
          "INSERT INTO docs_page_versions (organization_id, page_id, revision, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(organizationId, pageId, nextRevision, planned.title, planned.entry.content, timestamp);
        db.prepare(
          `UPDATE docs_pages SET title = ?, content = ?, revision = ?, status = 'published', updated_at = ? WHERE id = ?`,
        ).run(planned.title, planned.entry.content, nextRevision, timestamp, pageId);
        record = { ...record, title: planned.title, content: planned.entry.content, revision: nextRevision, status: "published" };
      } else if (wasRestored || record.title !== planned.title) {
        db.prepare("UPDATE docs_pages SET title = ?, status = 'published', updated_at = ? WHERE id = ?")
          .run(planned.title, timestamp, pageId);
        record = { ...record, title: planned.title, status: "published" };
      }
      if (record.source_path !== planned.entry.path || record.source_hash !== planned.entry.sha256) {
        db.prepare(
          "UPDATE docs_repository_pages SET source_path = ?, source_hash = ?, updated_at = ? WHERE page_id = ? AND project_id = ?",
        ).run(planned.entry.path, planned.entry.sha256, timestamp, pageId, projectId);
        record = { ...record, source_path: planned.entry.path, source_hash: planned.entry.sha256 };
      }
    }

    ensureManagedTagsInTransaction(db, pageId);
    ensureProjectLinkInTransaction(db, pageId, projectId);

    const mustSyncSource = planned.kind !== "unchanged" || planned.sourceNeedsRepair || contentChanged || wasRestored;
    if (mustSyncSource) {
      const source = upsertRepositoryDocSourceInTransaction(db, {
        sourceId: record.rag_source_id,
        projectId,
        pageId,
        title: planned.title,
        sourcePath: planned.entry.path,
        content: planned.entry.content,
        sourceHash: planned.entry.sha256,
        metadata: JSON.parse(expectedMetadata(projectId, pageId, planned.entry)),
      });
      db.prepare("UPDATE docs_repository_pages SET rag_source_id = ?, updated_at = ? WHERE page_id = ?")
        .run(source.sourceId, timestamp, pageId);
      record = { ...record, rag_source_id: source.sourceId, rag_source_hash: planned.entry.sha256 };
    }

    // Retire the legacy configured-doc source for the same repository path.
    // It predates the page-backed canonical identity and would otherwise make
    // repository content searchable twice after onboarding.
    db.prepare(
      "DELETE FROM rag_sources WHERE project_id = ? AND source_type = 'file' AND source_path = ?",
    ).run(projectId, planned.entry.path);

    resolvedPages.set(planned.entry.path, record);
    const operation = result.operations.find((candidate) => candidate.sourcePath === planned.entry.path && candidate.kind !== "archived");
    if (operation) operation.pageId = pageId;
  }

  for (const planned of plan.active) {
    const page = resolvedPages.get(planned.entry.path)!;
    const parentSourcePath = parentPathFor(planned.entry.path, new Set(resolvedPages.keys()));
    const parentPageId = parentSourcePath ? resolvedPages.get(parentSourcePath)!.page_id : null;
    if (page.parent_page_id !== parentPageId) {
      db.prepare("UPDATE docs_pages SET parent_page_id = ?, updated_at = ? WHERE id = ?")
        .run(parentPageId, timestamp, page.page_id);
    }
  }

  for (const archived of plan.archived) {
    if (archived.rag_source_id) db.prepare("DELETE FROM rag_sources WHERE id = ? AND project_id = ?").run(archived.rag_source_id, projectId);
    db.prepare(
      "DELETE FROM rag_sources WHERE project_id = ? AND source_type = 'file' AND source_path = ?",
    ).run(projectId, archived.source_path);
    if (archived.status !== "archived") {
      db.prepare("UPDATE docs_pages SET status = 'archived', updated_at = ? WHERE id = ?").run(timestamp, archived.page_id);
    }
    db.prepare("UPDATE docs_repository_pages SET updated_at = ? WHERE page_id = ?").run(timestamp, archived.page_id);
  }

  return result;
}

/**
 * Preview or atomically apply a complete repository Markdown manifest.
 * Missing files are intentionally interpreted as archive requests only for rows
 * already managed by this project; unmanaged Docs Workspace pages are untouched.
 */
export function syncRepositoryDocs(projectId: string, manifestInput: unknown, dryRun = false): RepositoryDocsSyncResult {
  const manifest = validateManifest(manifestInput);
  if (dryRun) return resultForPlan(buildPlan(getDb(dbPath()), projectId, manifest), true);

  const result = execTransaction(() => {
    const plan = buildPlan(getDb(dbPath()), projectId, manifest);
    return applyPlanInTransaction(projectId, plan);
  });
  if (
    result.operations.some((operation) => operation.kind !== "unchanged")
    || result.space.action === "created"
    || result.space.action === "repaired"
  ) {
    checkpointAfterWrite();
  }
  return result;
}
