ALTER TABLE learnings ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS idx_learnings_status ON learnings(status);
