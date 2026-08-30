-- USAGE-100: project-scoped, advisory-only thresholds over existing usage aggregates.
-- Thresholds never contain providers, currencies, prices, windows, credentials, or actions.

CREATE TABLE IF NOT EXISTS usage_advisory_thresholds (
  project_id TEXT NOT NULL PRIMARY KEY,
  request_count INTEGER CHECK(
    request_count IS NULL OR (
      typeof(request_count) = 'integer'
      AND request_count BETWEEN 0 AND 9007199254740991
    )
  ),
  total_tokens INTEGER CHECK(
    total_tokens IS NULL OR (
      typeof(total_tokens) = 'integer'
      AND total_tokens BETWEEN 0 AND 9007199254740991
    )
  ),
  reported_cost_amount NUMERIC CHECK(
    reported_cost_amount IS NULL OR (
      typeof(reported_cost_amount) IN ('integer', 'real')
      AND reported_cost_amount BETWEEN 0 AND 9007199254740991
    )
  ),
  cache_read_tokens INTEGER CHECK(
    cache_read_tokens IS NULL OR (
      typeof(cache_read_tokens) = 'integer'
      AND cache_read_tokens BETWEEN 0 AND 9007199254740991
    )
  ),
  cache_write_tokens INTEGER CHECK(
    cache_write_tokens IS NULL OR (
      typeof(cache_write_tokens) = 'integer'
      AND cache_write_tokens BETWEEN 0 AND 9007199254740991
    )
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(
    typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991
  ),
  created_at TEXT NOT NULL CHECK(
    created_at GLOB '????-??-??T??:??:??.???Z' AND datetime(created_at) IS NOT NULL
  ),
  updated_at TEXT NOT NULL CHECK(
    updated_at GLOB '????-??-??T??:??:??.???Z'
    AND datetime(updated_at) IS NOT NULL
    AND updated_at >= created_at
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
);
