-- 040_docs_integrity: Fix W0 contract defects discovered in contract review
-- Applied once by db.ts guard (checks for title column in docs_page_drafts)
-- Guard marker: -- 040_guarded appears in rebuilt table definitions

-- ── Section 1: Fix docs_page_projects.project_id from INTEGER to TEXT ──
-- projects.id is TEXT PRIMARY KEY; the FK must match.
-- Rebuild with correct type, preserving only rows with valid referents.

CREATE TABLE IF NOT EXISTS docs_page_projects_040new (
    page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, project_id)
);  -- 040_guarded

-- Copy valid rows: page exists, project exists, cast to TEXT
INSERT OR IGNORE INTO docs_page_projects_040new (page_id, project_id)
SELECT page_id, CAST(project_id AS TEXT)
FROM docs_page_projects
WHERE page_id IN (SELECT id FROM docs_pages)
  AND CAST(project_id AS TEXT) IN (SELECT id FROM projects);

DROP TABLE docs_page_projects;
ALTER TABLE docs_page_projects_040new RENAME TO docs_page_projects;

CREATE INDEX IF NOT EXISTS idx_docs_projects_project ON docs_page_projects(project_id);

-- ── Section 2: Deduplicate docs_page_versions and add UNIQUE constraint ──
-- Remove duplicate (page_id, revision) rows, keeping the latest (highest id)

DELETE FROM docs_page_versions WHERE id NOT IN (
    SELECT MAX(id) FROM docs_page_versions GROUP BY page_id, revision
);

-- Add unique constraint as index (SQLite idiom for multi-column UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_versions_page_rev_unique
    ON docs_page_versions(page_id, revision);

-- ── Section 3: Add draft metadata columns for unpublished title/slug ──
-- These columns allow drafts to carry working title/slug/content overrides
-- that get applied atomically during publishPage.

ALTER TABLE docs_page_drafts ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE docs_page_drafts ADD COLUMN slug TEXT NOT NULL DEFAULT '';
ALTER TABLE docs_page_drafts ADD COLUMN base_revision INTEGER;
