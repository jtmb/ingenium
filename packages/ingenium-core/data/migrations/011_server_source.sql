-- migrate:down ALTER TABLE servers DROP COLUMN source;
ALTER TABLE servers ADD COLUMN source TEXT NOT NULL DEFAULT 'opencode';
