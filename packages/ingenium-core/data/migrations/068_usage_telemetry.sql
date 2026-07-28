-- Provider-neutral, metadata-only OpenCode usage telemetry.
--
-- usage_events deliberately contains no message content, reasoning content,
-- tool payloads, provider credentials, or opaque upstream payload JSON. The
-- source instance + step-finish part identity is the replay-safe event key.

CREATE TABLE IF NOT EXISTS usage_project_mappings (
  source_instance TEXT NOT NULL CHECK(length(source_instance) BETWEEN 1 AND 512),
  source_project_id TEXT NOT NULL CHECK(length(source_project_id) BETWEEN 1 AND 512),
  ingenium_project_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('mapped', 'quarantined')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_source_session_id TEXT,
  last_source_session_updated_at TEXT,
  PRIMARY KEY(source_instance, source_project_id),
  CHECK(
    (status = 'mapped' AND ingenium_project_id IS NOT NULL)
    OR (status = 'quarantined' AND ingenium_project_id IS NULL)
  ),
  FOREIGN KEY(ingenium_project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_usage_project_mappings_ingenium_project
  ON usage_project_mappings(ingenium_project_id, source_instance);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_instance TEXT NOT NULL CHECK(length(source_instance) BETWEEN 1 AND 512),
  source_part_id TEXT NOT NULL CHECK(length(source_part_id) BETWEEN 1 AND 512),
  source_session_id TEXT NOT NULL CHECK(length(source_session_id) BETWEEN 1 AND 512),
  source_message_id TEXT NOT NULL CHECK(length(source_message_id) BETWEEN 1 AND 512),
  source_project_id TEXT NOT NULL CHECK(length(source_project_id) BETWEEN 1 AND 512),
  provider_id TEXT CHECK(provider_id IS NULL OR length(provider_id) BETWEEN 1 AND 512),
  model_id TEXT CHECK(model_id IS NULL OR length(model_id) BETWEEN 1 AND 512),
  agent_id TEXT CHECK(agent_id IS NULL OR length(agent_id) BETWEEN 1 AND 512),
  status TEXT NOT NULL CHECK(status IN ('success', 'error', 'partial', 'unknown')),
  occurred_at TEXT NOT NULL,
  total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens >= 0),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  reasoning_tokens INTEGER CHECK(reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  cache_read_tokens INTEGER CHECK(cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  cache_write_tokens INTEGER CHECK(cache_write_tokens IS NULL OR cache_write_tokens >= 0),
  cost_amount REAL CHECK(cost_amount IS NULL OR cost_amount >= 0),
  cost_status TEXT NOT NULL CHECK(cost_status IN ('known', 'partial', 'unavailable')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (cost_status = 'known' AND cost_amount IS NOT NULL AND cost_amount >= 0)
    OR (cost_status IN ('partial', 'unavailable') AND cost_amount IS NULL)
  ),
  UNIQUE(source_instance, source_part_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_usage_events_project_occurred
  ON usage_events(project_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_project_provider_model_agent_occurred
  ON usage_events(project_id, provider_id, model_id, agent_id, occurred_at DESC, id DESC);

-- A cursor is owned by the Ingenium project that explicitly mapped the
-- OpenCode project. There is no implicit global-project cursor or fallback.
CREATE TABLE IF NOT EXISTS usage_sync_state (
  source_instance TEXT NOT NULL CHECK(length(source_instance) BETWEEN 1 AND 512),
  project_id TEXT NOT NULL,
  cursor_updated_at TEXT,
  cursor_session_id TEXT,
  cursor_part_id TEXT,
  last_sync_started_at TEXT,
  last_sync_completed_at TEXT,
  last_successful_sync_at TEXT,
  last_error_code TEXT,
  PRIMARY KEY(source_instance, project_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
);
