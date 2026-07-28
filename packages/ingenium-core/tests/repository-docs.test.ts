import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createPage, createSpace, publishPage } from "../lib/tools/docs.js";
import {
  RepositoryDocsManifestError,
  RepositoryDocsSpaceConflictError,
  syncRepositoryDocs,
  validateRepositoryDocsManifest,
  type RepositoryDocsManifestEntry,
} from "../lib/tools/repository-docs.js";

let directory: string;
let projectId: string;

function entry(path: string, content: string): RepositoryDocsManifestEntry {
  return {
    path,
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
    fileType: "regular",
    isSymlink: false,
  };
}

function baseManifest(guideContent = "# Guide\n\nThe lighthouse is violet.") {
  return {
    files: [
      entry("docs/index.md", "# Repository Docs\n\nWelcome."),
      entry("docs/usage/guide.md", guideContent),
      entry("docs/usage/index.md", "# Usage\n\nUsage documentation."),
    ],
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-repository-docs-"));
  process.env.INGENIUM_HOME = join(directory, "ingenium-home");
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  projectId = createProject("repository-docs-test").id;
});

afterEach(() => {
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_HOME;
  rmSync(directory, { recursive: true, force: true });
});

describe("repository-authoritative documentation manifests", () => {
  it("validates only regular docs/*.md paths, matching hashes, bounded content, and non-secret source", () => {
    const valid = baseManifest();
    expect(validateRepositoryDocsManifest(valid)).toEqual(valid);

    const invalidPath = { files: [{ ...valid.files[0], path: "docs/../secrets.md" }] };
    const invalidHash = { files: [{ ...valid.files[0], sha256: "0".repeat(64) }] };
    const symlink = { files: [{ ...valid.files[0], isSymlink: true }] };
    const secret = { files: [entry("docs/security.md", "token: sk_abcdefghijklmnopqrstuvwxyz123456") ] };

    for (const manifest of [invalidPath, invalidHash, symlink, secret]) {
      expect(() => validateRepositoryDocsManifest(manifest)).toThrow(RepositoryDocsManifestError);
    }
  });

  it("previews without mutation, then creates linked, tagged hierarchy and canonical RAG sources", () => {
    const manifest = baseManifest();
    const preview = syncRepositoryDocs(projectId, manifest, true);
    expect(preview).toMatchObject({ dryRun: true, summary: { created: 3, ragCreated: 3 } });
    expect(preview.space).toEqual({
      action: "created",
      name: "repository-docs-test",
      slug: "repository-repository-docs-test",
    });
    expect((getDb(process.env.INGENIUM_CORE_DB_PATH!).prepare("SELECT count(*) AS count FROM docs_pages").get() as { count: number }).count).toBe(0);

    const applied = syncRepositoryDocs(projectId, manifest);
    expect(applied).toMatchObject({ dryRun: false, summary: { created: 3, archived: 0, ragCreated: 3 } });
    expect(applied.space).toMatchObject({
      action: "created",
      name: "repository-docs-test",
      slug: "repository-repository-docs-test",
    });

    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const guide = db.prepare(
      `SELECT rp.page_id, rp.source_path, rp.source_hash, rp.rag_source_id, p.parent_page_id, p.status
       FROM docs_repository_pages rp JOIN docs_pages p ON p.id = rp.page_id
       WHERE rp.project_id = ? AND rp.source_path = 'docs/usage/guide.md'`,
    ).get(projectId) as { page_id: number; source_path: string; source_hash: string; rag_source_id: string; parent_page_id: number; status: string };
    const usageIndex = db.prepare(
      "SELECT page_id FROM docs_repository_pages WHERE project_id = ? AND source_path = 'docs/usage/index.md'",
    ).get(projectId) as { page_id: number };
    const source = db.prepare("SELECT * FROM rag_sources WHERE id = ?").get(guide.rag_source_id) as any;
    const tags = db.prepare(
      `SELECT t.name FROM docs_tags t JOIN docs_page_tags pt ON pt.tag_id = t.id
       WHERE pt.page_id = ? ORDER BY t.name`,
    ).all(guide.page_id) as Array<{ name: string }>;

    expect(guide.parent_page_id).toBe(usageIndex.page_id);
    expect(guide.status).toBe("published");
    expect(tags.map((tag) => tag.name)).toEqual(["repository-doc", "repository-managed"]);
    expect(db.prepare("SELECT 1 FROM docs_page_projects WHERE page_id = ? AND project_id = ?").get(guide.page_id, projectId)).toBeTruthy();
    expect(source).toMatchObject({
      project_id: projectId,
      source_type: "file",
      source_hash: guide.source_hash,
      source_path: `repository-doc:${projectId}:${guide.page_id}`,
    });
    expect(JSON.parse(source.metadata)).toMatchObject({
      kind: "repository_doc",
      managed: true,
      repositoryPath: "docs/usage/guide.md",
      pageId: guide.page_id,
      managedTags: ["repository-managed", "repository-doc"],
    });
    expect((db.prepare("SELECT count(*) AS count FROM rag_chunks WHERE source_id = ?").get(source.id) as { count: number }).count).toBeGreaterThan(0);
  });

  it("repairs legacy UUID-named spaces without changing managed page, relationship, or RAG identities", () => {
    const manifest = baseManifest();
    syncRepositoryDocs(projectId, manifest);
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const pagesBefore = db.prepare(
      `SELECT p.id AS page_id, p.space_id, p.revision, rp.rag_source_id
       FROM docs_repository_pages rp
       INNER JOIN docs_pages p ON p.id = rp.page_id
       WHERE rp.project_id = ?
       ORDER BY p.id`,
    ).all(projectId);
    const spaceId = (pagesBefore[0] as { space_id: number }).space_id;
    const pageVersionsBefore = db.prepare(
      `SELECT page_id, revision FROM docs_page_versions
       WHERE page_id IN (SELECT page_id FROM docs_repository_pages WHERE project_id = ?)
       ORDER BY page_id, revision`,
    ).all(projectId);
    const projectLinksBefore = db.prepare(
      `SELECT page_id, project_id FROM docs_page_projects
       WHERE project_id = ? ORDER BY page_id, project_id`,
    ).all(projectId);
    const managedTagsBefore = db.prepare(
      `SELECT pt.page_id, t.name FROM docs_page_tags pt
       INNER JOIN docs_tags t ON t.id = pt.tag_id
       WHERE pt.page_id IN (SELECT page_id FROM docs_repository_pages WHERE project_id = ?)
       ORDER BY pt.page_id, t.name`,
    ).all(projectId);

    db.prepare("UPDATE docs_spaces SET name = ?, slug = ? WHERE id = ?")
      .run(`Repository Docs ${projectId}`, `repository-${projectId}`, spaceId);

    const preview = syncRepositoryDocs(projectId, manifest, true);
    expect(preview).toMatchObject({
      dryRun: true,
      summary: { spaceRepaired: 1, updated: 0 },
      space: {
        action: "repaired",
        id: spaceId,
        name: "repository-docs-test",
        slug: "repository-repository-docs-test",
      },
    });
    expect(db.prepare("SELECT name, slug FROM docs_spaces WHERE id = ?").get(spaceId)).toEqual({
      name: `Repository Docs ${projectId}`,
      slug: `repository-${projectId}`,
    });

    const applied = syncRepositoryDocs(projectId, manifest);
    expect(applied).toMatchObject({
      dryRun: false,
      summary: { spaceRepaired: 1, updated: 0 },
      space: { action: "repaired", id: spaceId },
    });
    expect(db.prepare("SELECT name, slug FROM docs_spaces WHERE id = ?").get(spaceId)).toEqual({
      name: "repository-docs-test",
      slug: "repository-repository-docs-test",
    });
    expect(db.prepare(
      `SELECT p.id AS page_id, p.space_id, p.revision, rp.rag_source_id
       FROM docs_repository_pages rp
       INNER JOIN docs_pages p ON p.id = rp.page_id
       WHERE rp.project_id = ?
       ORDER BY p.id`,
    ).all(projectId)).toEqual(pagesBefore);
    expect(db.prepare(
      `SELECT page_id, revision FROM docs_page_versions
       WHERE page_id IN (SELECT page_id FROM docs_repository_pages WHERE project_id = ?)
       ORDER BY page_id, revision`,
    ).all(projectId)).toEqual(pageVersionsBefore);
    expect(db.prepare(
      `SELECT page_id, project_id FROM docs_page_projects
       WHERE project_id = ? ORDER BY page_id, project_id`,
    ).all(projectId)).toEqual(projectLinksBefore);
    expect(db.prepare(
      `SELECT pt.page_id, t.name FROM docs_page_tags pt
       INNER JOIN docs_tags t ON t.id = pt.tag_id
       WHERE pt.page_id IN (SELECT page_id FROM docs_repository_pages WHERE project_id = ?)
       ORDER BY pt.page_id, t.name`,
    ).all(projectId)).toEqual(managedTagsBefore);

    const repeated = syncRepositoryDocs(projectId, manifest);
    expect(repeated).toMatchObject({
      summary: { spaceCreated: 0, spaceRepaired: 0, unchanged: 3 },
      space: { action: "unchanged", id: spaceId },
    });
    expect(db.prepare("SELECT name, slug FROM docs_spaces WHERE id = ?").get(spaceId)).toEqual({
      name: "repository-docs-test",
      slug: "repository-repository-docs-test",
    });
  });

  it("refuses a canonical space collision without overwriting either Docs space", () => {
    const manifest = baseManifest();
    syncRepositoryDocs(projectId, manifest);
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const managedSpace = db.prepare(
      `SELECT p.space_id FROM docs_repository_pages rp
       INNER JOIN docs_pages p ON p.id = rp.page_id
       WHERE rp.project_id = ? LIMIT 1`,
    ).get(projectId) as { space_id: number };
    db.prepare("UPDATE docs_spaces SET name = ?, slug = ? WHERE id = ?")
      .run(`Repository Docs ${projectId}`, `repository-${projectId}`, managedSpace.space_id);
    const collision = createSpace("repository-docs-test", "occupied-repository-docs-test");
    const pageCount = (db.prepare("SELECT count(*) AS count FROM docs_pages").get() as { count: number }).count;

    expect(() => syncRepositoryDocs(projectId, manifest, true)).toThrow(RepositoryDocsSpaceConflictError);
    expect(() => syncRepositoryDocs(projectId, manifest)).toThrow(RepositoryDocsSpaceConflictError);
    expect(db.prepare("SELECT name, slug FROM docs_spaces WHERE id = ?").get(managedSpace.space_id)).toEqual({
      name: `Repository Docs ${projectId}`,
      slug: `repository-${projectId}`,
    });
    expect(db.prepare("SELECT name, slug FROM docs_spaces WHERE id = ?").get(collision.id)).toEqual({
      name: "repository-docs-test",
      slug: "occupied-repository-docs-test",
    });
    expect((db.prepare("SELECT count(*) AS count FROM docs_pages").get() as { count: number }).count).toBe(pageCount);
  });

  it("is hash-idempotent, updates in place, and treats a unique hash move as a rename", () => {
    const original = baseManifest();
    syncRepositoryDocs(projectId, original);
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const before = db.prepare(
      "SELECT page_id, rag_source_id FROM docs_repository_pages WHERE project_id = ? AND source_path = 'docs/usage/guide.md'",
    ).get(projectId) as { page_id: number; rag_source_id: string };

    expect(syncRepositoryDocs(projectId, original)).toMatchObject({ summary: { unchanged: 3, updated: 0 } });

    const changed = baseManifest("# Guide\n\nThe lighthouse is amber.");
    expect(syncRepositoryDocs(projectId, changed)).toMatchObject({ summary: { updated: 1 } });
    const afterUpdate = db.prepare(
      "SELECT page_id, rag_source_id, source_hash FROM docs_repository_pages WHERE project_id = ? AND source_path = 'docs/usage/guide.md'",
    ).get(projectId) as { page_id: number; rag_source_id: string; source_hash: string };
    expect(afterUpdate.page_id).toBe(before.page_id);
    expect(afterUpdate.rag_source_id).toBe(before.rag_source_id);

    const renamed = {
      files: changed.files.map((file) => file.path === "docs/usage/guide.md"
        ? { ...file, path: "docs/usage/renamed-guide.md" }
        : file),
    };
    const result = syncRepositoryDocs(projectId, renamed);
    expect(result).toMatchObject({ summary: { renamed: 1, created: 0 } });
    const afterRename = db.prepare(
      "SELECT page_id, rag_source_id, source_path FROM docs_repository_pages WHERE project_id = ? AND source_path = 'docs/usage/renamed-guide.md'",
    ).get(projectId) as { page_id: number; rag_source_id: string; source_path: string };
    expect(afterRename).toMatchObject({ page_id: before.page_id, rag_source_id: before.rag_source_id });
    expect(db.prepare("SELECT 1 FROM docs_repository_pages WHERE project_id = ? AND source_path = 'docs/usage/guide.md'").get(projectId)).toBeFalsy();
  });

  it("archives only missing managed pages, removes their RAG source, and keeps unmanaged pages", () => {
    const manifest = baseManifest();
    syncRepositoryDocs(projectId, manifest);
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const space = createSpace("Unmanaged docs", "unmanaged-docs");
    const manual = createPage(space.id, "Manual page", "manual-page", "Manual content").page!;
    publishPage(manual.id);
    const guide = db.prepare(
      "SELECT page_id, rag_source_id FROM docs_repository_pages WHERE project_id = ? AND source_path = 'docs/usage/guide.md'",
    ).get(projectId) as { page_id: number; rag_source_id: string };

    const result = syncRepositoryDocs(projectId, { files: [manifest.files[0]!] });
    expect(result).toMatchObject({ summary: { archived: 2, ragDeleted: 2 } });
    expect(db.prepare("SELECT status FROM docs_pages WHERE id = ?").get(guide.page_id)).toEqual({ status: "archived" });
    expect(db.prepare("SELECT 1 FROM rag_sources WHERE id = ?").get(guide.rag_source_id)).toBeFalsy();
    expect(db.prepare("SELECT rag_source_id FROM docs_repository_pages WHERE page_id = ?").get(guide.page_id)).toEqual({ rag_source_id: null });
    expect(db.prepare("SELECT status FROM docs_pages WHERE id = ?").get(manual.id)).toEqual({ status: "published" });
  });

  it("rolls page and source changes back together when RAG insertion fails", () => {
    const original = { files: [entry("docs/index.md", "# Original\n\nThe original beacon.")] };
    syncRepositoryDocs(projectId, original);
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const before = db.prepare(
      `SELECT rp.page_id, p.content, rp.rag_source_id, rs.source_hash
       FROM docs_repository_pages rp JOIN docs_pages p ON p.id = rp.page_id
       JOIN rag_sources rs ON rs.id = rp.rag_source_id WHERE rp.project_id = ?`,
    ).get(projectId) as { page_id: number; content: string; rag_source_id: string; source_hash: string };
    db.exec("CREATE TRIGGER fail_repository_rag_chunk BEFORE INSERT ON rag_chunks BEGIN SELECT RAISE(ABORT, 'forced repository chunk failure'); END");

    expect(() => syncRepositoryDocs(projectId, { files: [entry("docs/index.md", "# Changed\n\nThe changed beacon.")] })).toThrow("forced repository chunk failure");
    expect(db.prepare("SELECT content FROM docs_pages WHERE id = ?").get(before.page_id)).toEqual({ content: before.content });
    expect(db.prepare("SELECT source_hash FROM rag_sources WHERE id = ?").get(before.rag_source_id)).toEqual({ source_hash: before.source_hash });
  });

  it("keeps managed records and RAG sources isolated by project", () => {
    const otherProjectId = createProject("repository-docs-other").id;
    const manifest = { files: [entry("docs/index.md", "# Shared name\n\nProject-specific content.")] };
    syncRepositoryDocs(projectId, manifest);
    syncRepositoryDocs(otherProjectId, manifest);
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const rows = db.prepare(
      "SELECT project_id, rag_source_id FROM docs_repository_pages WHERE source_path = 'docs/index.md' ORDER BY project_id",
    ).all() as Array<{ project_id: string; rag_source_id: string }>;

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.project_id))).toEqual(new Set([projectId, otherProjectId]));
    expect(rows[0]!.rag_source_id).not.toBe(rows[1]!.rag_source_id);
  });
});
