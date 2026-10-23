ALTER TABLE plugins ADD COLUMN description TEXT NOT NULL DEFAULT '';

UPDATE plugins SET description = CASE name
  WHEN 'auto-observer' THEN 'Extracts learning observations from user conversations.'
  WHEN 'observer' THEN 'Imports fallback observations and triggers learning synthesis.'
  WHEN 'resource-sync' THEN 'Synchronizes repository resources into the project workspace.'
  WHEN 'session-coordinator' THEN 'Coordinates shared-worktree sessions, ownership, and recovery.'
  WHEN 'ponytail' THEN 'Encourages minimal, practical implementations through Ponytail mode.'
  ELSE 'Project-local OpenCode plugin.'
END;
