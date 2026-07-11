-- migrate:down ALTER TABLE projects DROP COLUMN is_global;
ALTER TABLE projects ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0;
