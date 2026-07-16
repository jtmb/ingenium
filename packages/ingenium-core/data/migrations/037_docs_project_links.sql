-- 037_docs_project_links: Optional project associations for pages
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_page_projects (
    page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_docs_projects_project ON docs_page_projects(project_id);
