-- USAGE-101: durable, advisory-only attention lifecycle over all-history
-- usage threshold evaluation. Rows deliberately contain only allowlisted,
-- provider-neutral metadata; no payload, free text, source, or JSON columns.

BEGIN IMMEDIATE;

CREATE TABLE usage_attention_items (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  condition TEXT NOT NULL CHECK(condition IN (
    'usage.advisory:v1:all-history:request_count',
    'usage.advisory:v1:all-history:total_tokens',
    'usage.advisory:v1:all-history:reported_cost_amount',
    'usage.advisory:v1:all-history:cache_read_tokens',
    'usage.advisory:v1:all-history:cache_write_tokens'
  )),
  metric TEXT NOT NULL CHECK(metric IN (
    'request_count', 'total_tokens', 'reported_cost_amount',
    'cache_read_tokens', 'cache_write_tokens'
  )),
  status TEXT NOT NULL CHECK(status IN ('active', 'resolved')),
  evaluation_state TEXT NOT NULL CHECK(evaluation_state IN ('disabled', 'unknown', 'below', 'equal', 'above')),
  severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
  message_code TEXT NOT NULL CHECK(message_code IN (
    'USAGE_ADVISORY_DISABLED', 'USAGE_ADVISORY_UNKNOWN', 'USAGE_ADVISORY_BELOW',
    'USAGE_ADVISORY_EQUAL', 'USAGE_ADVISORY_ABOVE'
  )),
  observed NUMERIC CHECK(observed IS NULL OR (
    typeof(observed) IN ('integer', 'real')
    AND observed = observed
    AND observed BETWEEN 0 AND 9007199254740991
  )),
  threshold NUMERIC CHECK(threshold IS NULL OR (
    typeof(threshold) IN ('integer', 'real')
    AND threshold = threshold
    AND threshold BETWEEN 0 AND 9007199254740991
  )),
  availability TEXT NOT NULL CHECK(availability IN ('known', 'partial', 'unavailable')),
  freshness TEXT NOT NULL CHECK(freshness IN ('disabled', 'unknown', 'fresh', 'stale')),
  range_from TEXT,
  range_to TEXT,
  threshold_revision INTEGER NOT NULL CHECK(
    typeof(threshold_revision) = 'integer'
    AND threshold_revision BETWEEN 1 AND 9007199254740991
  ),
  opened_at TEXT NOT NULL CHECK(
    opened_at GLOB '????-??-??T??:??:??.???Z' AND datetime(opened_at) IS NOT NULL
  ),
  acknowledged_at TEXT CHECK(
    acknowledged_at IS NULL OR (
      acknowledged_at GLOB '????-??-??T??:??:??.???Z' AND datetime(acknowledged_at) IS NOT NULL
    )
  ),
  resolved_at TEXT CHECK(
    resolved_at IS NULL OR (
      resolved_at GLOB '????-??-??T??:??:??.???Z' AND datetime(resolved_at) IS NOT NULL
    )
  ),
  reopened_at TEXT CHECK(
    reopened_at IS NULL OR (
      reopened_at GLOB '????-??-??T??:??:??.???Z' AND datetime(reopened_at) IS NOT NULL
    )
  ),
  reopen_count INTEGER NOT NULL DEFAULT 0 CHECK(
    typeof(reopen_count) = 'integer' AND reopen_count BETWEEN 0 AND 9007199254740991
  ),
  last_evaluated_at TEXT NOT NULL CHECK(
    last_evaluated_at GLOB '????-??-??T??:??:??.???Z' AND datetime(last_evaluated_at) IS NOT NULL
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(
    typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991
  ),
  created_at TEXT NOT NULL CHECK(
    created_at GLOB '????-??-??T??:??:??.???Z' AND datetime(created_at) IS NOT NULL
  ),
  updated_at TEXT NOT NULL CHECK(
    updated_at GLOB '????-??-??T??:??:??.???Z' AND datetime(updated_at) IS NOT NULL
  ),
  UNIQUE(project_id, id),
  UNIQUE(project_id, condition),
  CHECK(condition = 'usage.advisory:v1:all-history:' || metric),
  -- USAGE-101 reconciles the explicit all-history evaluator only.
  CHECK(range_from IS NULL AND range_to IS NULL),
  CHECK(availability <> 'known' OR observed IS NOT NULL),
  CHECK(availability <> 'unavailable' OR observed IS NULL),
  CHECK(
    (evaluation_state = 'disabled'
      AND status = 'resolved' AND severity = 'info'
      AND message_code = 'USAGE_ADVISORY_DISABLED' AND threshold IS NULL)
    OR (evaluation_state = 'below'
      AND status = 'resolved' AND severity = 'info'
      AND message_code = 'USAGE_ADVISORY_BELOW'
      AND observed IS NOT NULL AND threshold IS NOT NULL AND availability = 'known')
    OR (evaluation_state = 'unknown'
      AND status = 'active' AND severity = 'info'
      AND message_code = 'USAGE_ADVISORY_UNKNOWN'
      AND threshold IS NOT NULL AND availability IN ('partial', 'unavailable'))
    OR (evaluation_state = 'equal'
      AND status = 'active' AND severity = 'warning'
      AND message_code = 'USAGE_ADVISORY_EQUAL'
      AND observed IS NOT NULL AND threshold IS NOT NULL AND availability = 'known')
    OR (evaluation_state = 'above'
      AND status = 'active' AND severity = 'critical'
      AND message_code = 'USAGE_ADVISORY_ABOVE'
      AND observed IS NOT NULL AND threshold IS NOT NULL AND availability = 'known')
  ),
  CHECK(
    (status = 'active' AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL
      AND resolved_at >= COALESCE(reopened_at, opened_at))
  ),
  CHECK(
    (reopen_count = 0 AND reopened_at IS NULL)
    OR (reopen_count >= 1 AND reopened_at IS NOT NULL AND reopened_at >= opened_at)
  ),
  CHECK(acknowledged_at IS NULL OR acknowledged_at >= opened_at),
  CHECK(last_evaluated_at >= opened_at),
  CHECK(updated_at >= created_at),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE TABLE usage_attention_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  transition TEXT NOT NULL CHECK(transition IN ('opened', 'changed', 'resolved', 'reopened', 'ack')),
  prior_status TEXT CHECK(prior_status IS NULL OR prior_status IN ('active', 'resolved')),
  current_status TEXT NOT NULL CHECK(current_status IN ('active', 'resolved')),
  prior_evaluation_state TEXT CHECK(prior_evaluation_state IS NULL OR prior_evaluation_state IN ('disabled', 'unknown', 'below', 'equal', 'above')),
  current_evaluation_state TEXT NOT NULL CHECK(current_evaluation_state IN ('disabled', 'unknown', 'below', 'equal', 'above')),
  prior_severity TEXT CHECK(prior_severity IS NULL OR prior_severity IN ('info', 'warning', 'critical')),
  current_severity TEXT NOT NULL CHECK(current_severity IN ('info', 'warning', 'critical')),
  prior_message_code TEXT CHECK(prior_message_code IS NULL OR prior_message_code IN (
    'USAGE_ADVISORY_DISABLED', 'USAGE_ADVISORY_UNKNOWN', 'USAGE_ADVISORY_BELOW',
    'USAGE_ADVISORY_EQUAL', 'USAGE_ADVISORY_ABOVE'
  )),
  current_message_code TEXT NOT NULL CHECK(current_message_code IN (
    'USAGE_ADVISORY_DISABLED', 'USAGE_ADVISORY_UNKNOWN', 'USAGE_ADVISORY_BELOW',
    'USAGE_ADVISORY_EQUAL', 'USAGE_ADVISORY_ABOVE'
  )),
  prior_observed NUMERIC CHECK(prior_observed IS NULL OR (
    typeof(prior_observed) IN ('integer', 'real') AND prior_observed = prior_observed
    AND prior_observed BETWEEN 0 AND 9007199254740991
  )),
  current_observed NUMERIC CHECK(current_observed IS NULL OR (
    typeof(current_observed) IN ('integer', 'real') AND current_observed = current_observed
    AND current_observed BETWEEN 0 AND 9007199254740991
  )),
  prior_threshold NUMERIC CHECK(prior_threshold IS NULL OR (
    typeof(prior_threshold) IN ('integer', 'real') AND prior_threshold = prior_threshold
    AND prior_threshold BETWEEN 0 AND 9007199254740991
  )),
  current_threshold NUMERIC CHECK(current_threshold IS NULL OR (
    typeof(current_threshold) IN ('integer', 'real') AND current_threshold = current_threshold
    AND current_threshold BETWEEN 0 AND 9007199254740991
  )),
  prior_availability TEXT CHECK(prior_availability IS NULL OR prior_availability IN ('known', 'partial', 'unavailable')),
  current_availability TEXT NOT NULL CHECK(current_availability IN ('known', 'partial', 'unavailable')),
  prior_freshness TEXT CHECK(prior_freshness IS NULL OR prior_freshness IN ('disabled', 'unknown', 'fresh', 'stale')),
  current_freshness TEXT NOT NULL CHECK(current_freshness IN ('disabled', 'unknown', 'fresh', 'stale')),
  prior_threshold_revision INTEGER CHECK(prior_threshold_revision IS NULL OR (
    typeof(prior_threshold_revision) = 'integer' AND prior_threshold_revision BETWEEN 1 AND 9007199254740991
  )),
  current_threshold_revision INTEGER NOT NULL CHECK(
    typeof(current_threshold_revision) = 'integer' AND current_threshold_revision BETWEEN 1 AND 9007199254740991
  ),
  prior_last_evaluated_at TEXT CHECK(prior_last_evaluated_at IS NULL OR (
    prior_last_evaluated_at GLOB '????-??-??T??:??:??.???Z' AND datetime(prior_last_evaluated_at) IS NOT NULL
  )),
  current_last_evaluated_at TEXT NOT NULL CHECK(
    current_last_evaluated_at GLOB '????-??-??T??:??:??.???Z' AND datetime(current_last_evaluated_at) IS NOT NULL
  ),
  prior_acknowledged_at TEXT CHECK(prior_acknowledged_at IS NULL OR (
    prior_acknowledged_at GLOB '????-??-??T??:??:??.???Z' AND datetime(prior_acknowledged_at) IS NOT NULL
  )),
  current_acknowledged_at TEXT CHECK(current_acknowledged_at IS NULL OR (
    current_acknowledged_at GLOB '????-??-??T??:??:??.???Z' AND datetime(current_acknowledged_at) IS NOT NULL
  )),
  created_at TEXT NOT NULL CHECK(
    created_at GLOB '????-??-??T??:??:??.???Z' AND datetime(created_at) IS NOT NULL
  ),
  CHECK(
    (current_evaluation_state = 'disabled'
      AND current_status = 'resolved' AND current_severity = 'info'
      AND current_message_code = 'USAGE_ADVISORY_DISABLED' AND current_threshold IS NULL)
    OR (current_evaluation_state = 'below'
      AND current_status = 'resolved' AND current_severity = 'info'
      AND current_message_code = 'USAGE_ADVISORY_BELOW'
      AND current_observed IS NOT NULL AND current_threshold IS NOT NULL AND current_availability = 'known')
    OR (current_evaluation_state = 'unknown'
      AND current_status = 'active' AND current_severity = 'info'
      AND current_message_code = 'USAGE_ADVISORY_UNKNOWN'
      AND current_threshold IS NOT NULL AND current_availability IN ('partial', 'unavailable'))
    OR (current_evaluation_state = 'equal'
      AND current_status = 'active' AND current_severity = 'warning'
      AND current_message_code = 'USAGE_ADVISORY_EQUAL'
      AND current_observed IS NOT NULL AND current_threshold IS NOT NULL AND current_availability = 'known')
    OR (current_evaluation_state = 'above'
      AND current_status = 'active' AND current_severity = 'critical'
      AND current_message_code = 'USAGE_ADVISORY_ABOVE'
      AND current_observed IS NOT NULL AND current_threshold IS NOT NULL AND current_availability = 'known')
  ),
  CHECK(current_availability <> 'known' OR current_observed IS NOT NULL),
  CHECK(current_availability <> 'unavailable' OR current_observed IS NULL),
  CHECK(
    (prior_status IS NULL AND prior_evaluation_state IS NULL AND prior_severity IS NULL
      AND prior_message_code IS NULL AND prior_observed IS NULL AND prior_threshold IS NULL
      AND prior_availability IS NULL AND prior_freshness IS NULL
      AND prior_threshold_revision IS NULL AND prior_last_evaluated_at IS NULL
      AND prior_acknowledged_at IS NULL)
    OR (
      (prior_evaluation_state = 'disabled'
        AND prior_status = 'resolved' AND prior_severity = 'info'
        AND prior_message_code = 'USAGE_ADVISORY_DISABLED' AND prior_threshold IS NULL)
      OR (prior_evaluation_state = 'below'
        AND prior_status = 'resolved' AND prior_severity = 'info'
        AND prior_message_code = 'USAGE_ADVISORY_BELOW'
        AND prior_observed IS NOT NULL AND prior_threshold IS NOT NULL AND prior_availability = 'known')
      OR (prior_evaluation_state = 'unknown'
        AND prior_status = 'active' AND prior_severity = 'info'
        AND prior_message_code = 'USAGE_ADVISORY_UNKNOWN'
        AND prior_threshold IS NOT NULL AND prior_availability IN ('partial', 'unavailable'))
      OR (prior_evaluation_state = 'equal'
        AND prior_status = 'active' AND prior_severity = 'warning'
        AND prior_message_code = 'USAGE_ADVISORY_EQUAL'
        AND prior_observed IS NOT NULL AND prior_threshold IS NOT NULL AND prior_availability = 'known')
      OR (prior_evaluation_state = 'above'
        AND prior_status = 'active' AND prior_severity = 'critical'
        AND prior_message_code = 'USAGE_ADVISORY_ABOVE'
        AND prior_observed IS NOT NULL AND prior_threshold IS NOT NULL AND prior_availability = 'known')
    )
  ),
  CHECK(prior_status IS NULL OR prior_availability <> 'known' OR prior_observed IS NOT NULL),
  CHECK(prior_status IS NULL OR prior_availability <> 'unavailable' OR prior_observed IS NULL),
  CHECK(
    (transition = 'opened' AND prior_status IS NULL AND current_status = 'active')
    OR (transition = 'changed' AND prior_status = 'active' AND current_status = 'active')
    OR (transition = 'resolved' AND prior_status = 'active' AND current_status = 'resolved')
    OR (transition = 'reopened' AND prior_status = 'resolved' AND current_status = 'active')
    OR (transition = 'ack' AND prior_status = current_status
      AND prior_evaluation_state = current_evaluation_state
      AND prior_severity = current_severity
      AND prior_message_code = current_message_code
      AND prior_observed IS current_observed
      AND prior_threshold IS current_threshold
      AND prior_availability = current_availability
      AND prior_freshness = current_freshness
      AND prior_threshold_revision = current_threshold_revision
      AND prior_last_evaluated_at = current_last_evaluated_at
      AND prior_acknowledged_at IS NULL AND current_acknowledged_at IS NOT NULL)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, item_id) REFERENCES usage_attention_items(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_usage_attention_items_project_status_updated
  ON usage_attention_items(project_id, status, updated_at DESC, id DESC);
CREATE INDEX idx_usage_attention_events_project_item_created
  ON usage_attention_events(project_id, item_id, created_at ASC, id ASC);

CREATE TRIGGER usage_attention_items_identity_immutable_update
BEFORE UPDATE ON usage_attention_items
WHEN NEW.id <> OLD.id
  OR NEW.project_id <> OLD.project_id
  OR NEW.condition <> OLD.condition
  OR NEW.metric <> OLD.metric
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'usage attention item identity is immutable');
END;

CREATE TRIGGER usage_attention_items_monotonic_update
BEFORE UPDATE ON usage_attention_items
WHEN NEW.revision <= OLD.revision
  OR NEW.updated_at < OLD.updated_at
  OR NEW.last_evaluated_at < OLD.last_evaluated_at
BEGIN
  SELECT RAISE(ABORT, 'usage attention item revision and timestamps must be monotonic');
END;

CREATE TRIGGER usage_attention_events_immutable_update
BEFORE UPDATE ON usage_attention_events
BEGIN
  SELECT RAISE(ABORT, 'usage attention events are immutable');
END;

CREATE TRIGGER usage_attention_events_immutable_delete
BEFORE DELETE ON usage_attention_events
BEGIN
  SELECT RAISE(ABORT, 'usage attention events are immutable');
END;

COMMIT;
