-- Allocated by coordinator. Additive metadata only; original resources/IDs remain intact.
-- Coordinator allocates the migration number and installs on the API-owned DB.
-- No transcript, explicit-memory, instruction, skill or scheduler tables change.
CREATE TABLE veyra_memory_policy (
  scope_key TEXT PRIMARY KEY CHECK(json_valid(scope_key) AND json_array_length(scope_key)=6),
  scope_organization_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[0]')) VIRTUAL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope_owner_user_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[1]')) VIRTUAL REFERENCES users(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  generate INTEGER NOT NULL CHECK(generate IN (0,1)),
  use_memory INTEGER NOT NULL CHECK(use_memory IN (0,1)),
  external_context INTEGER NOT NULL CHECK(external_context IN (0,1))
);
CREATE TABLE veyra_memory_chat_policy (
  scope_key TEXT NOT NULL CHECK(json_valid(scope_key) AND json_array_length(scope_key)=6),
  scope_organization_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[0]')) VIRTUAL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope_owner_user_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[1]')) VIRTUAL REFERENCES users(id) ON DELETE RESTRICT,
  chat_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  use_memory INTEGER NOT NULL CHECK(use_memory IN (0,1)),
  contribute INTEGER NOT NULL CHECK(contribute IN (0,1)),
  PRIMARY KEY(scope_key, chat_id)
);
CREATE TABLE veyra_memory_recall (
  scope_key TEXT NOT NULL CHECK(json_valid(scope_key) AND json_array_length(scope_key)=6),
  scope_organization_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[0]')) VIRTUAL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope_owner_user_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[1]')) VIRTUAL REFERENCES users(id) ON DELETE RESTRICT,
  id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  version INTEGER NOT NULL CHECK(version >= 1),
  state TEXT NOT NULL CHECK(state IN ('active','forgotten')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_key,id),
  CHECK(state = 'active' OR (content = '' AND provenance_json = '[]'))
);
CREATE TABLE veyra_memory_suppression (
  scope_key TEXT NOT NULL CHECK(json_valid(scope_key) AND json_array_length(scope_key)=6),
  scope_organization_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[0]')) VIRTUAL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope_owner_user_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[1]')) VIRTUAL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('memory','source','content')),
  target TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  PRIMARY KEY(scope_key,kind,target)
);
CREATE TABLE veyra_memory_receipt (
  scope_key TEXT NOT NULL CHECK(json_valid(scope_key) AND json_array_length(scope_key)=6),
  scope_organization_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[0]')) VIRTUAL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope_owner_user_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[1]')) VIRTUAL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  PRIMARY KEY(scope_key,operation_id)
);
CREATE INDEX veyra_memory_recall_active ON veyra_memory_recall(scope_key,state,updated_at,id);
CREATE TABLE veyra_memory_extraction (
  scope_key TEXT NOT NULL CHECK(json_valid(scope_key) AND json_array_length(scope_key)=6),
  scope_organization_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[0]')) VIRTUAL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope_owner_user_id TEXT GENERATED ALWAYS AS (json_extract(scope_key,'$[1]')) VIRTUAL REFERENCES users(id) ON DELETE RESTRICT,
  input_hash TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  PRIMARY KEY(scope_key,input_hash)
);
CREATE TRIGGER veyra_memory_receipt_immutable_update BEFORE UPDATE ON veyra_memory_receipt
BEGIN SELECT RAISE(ABORT,'memory receipt is immutable'); END;
CREATE TRIGGER veyra_memory_receipt_immutable_delete BEFORE DELETE ON veyra_memory_receipt
BEGIN SELECT RAISE(ABORT,'memory receipt is immutable'); END;
CREATE TRIGGER veyra_memory_suppression_immutable_update BEFORE UPDATE ON veyra_memory_suppression
BEGIN SELECT RAISE(ABORT,'memory suppression is immutable'); END;
CREATE TRIGGER veyra_memory_suppression_immutable_delete BEFORE DELETE ON veyra_memory_suppression
BEGIN SELECT RAISE(ABORT,'memory suppression is immutable'); END;
CREATE TRIGGER veyra_memory_extraction_immutable_update BEFORE UPDATE ON veyra_memory_extraction
BEGIN SELECT RAISE(ABORT,'memory watermark is immutable'); END;
CREATE TRIGGER veyra_memory_extraction_immutable_delete BEFORE DELETE ON veyra_memory_extraction
BEGIN SELECT RAISE(ABORT,'memory watermark is immutable'); END;
