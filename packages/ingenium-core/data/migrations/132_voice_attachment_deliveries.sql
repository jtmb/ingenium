-- Call attachment delivery metadata on the existing Core writer; no Run/chat/model lease.
CREATE TABLE veyra_voice_attachment_deliveries (
  scope_hash TEXT NOT NULL CHECK(length(scope_hash)=64),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 256),
  kind TEXT NOT NULL CHECK(kind IN ('message','cancel-agent')),
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
  original_message_id TEXT NOT NULL CHECK(length(original_message_id) BETWEEN 1 AND 128),
  state TEXT NOT NULL CHECK(state IN ('intent','ack','unknown')),
  ack_kind TEXT CHECK(ack_kind IN ('delivered','pending','rejected')),
  ack_hash TEXT CHECK(ack_hash IS NULL OR length(ack_hash)=64),
  revision INTEGER NOT NULL CHECK(revision IN (1,2)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(updated_at>=created_at),
  PRIMARY KEY(scope_hash,request_id,kind),
  CHECK((state='intent' AND revision=1 AND ack_kind IS NULL AND ack_hash IS NULL)
    OR (state='unknown' AND revision=2 AND ack_kind IS NULL AND ack_hash IS NULL)
    OR (state='ack' AND revision=2 AND ack_kind IS NOT NULL AND ack_hash IS NOT NULL)),
  CHECK(kind<>'message' OR ack_kind IS NULL OR ack_kind IN ('delivered','rejected'))
) WITHOUT ROWID;
CREATE TRIGGER veyra_voice_attachment_insert_collision
BEFORE INSERT ON veyra_voice_attachment_deliveries
WHEN EXISTS(SELECT 1 FROM veyra_voice_attachment_deliveries
  WHERE scope_hash=NEW.scope_hash AND request_id=NEW.request_id AND kind=NEW.kind)
BEGIN SELECT RAISE(ABORT,'voice attachment original already exists'); END;
CREATE TRIGGER veyra_voice_attachment_no_delete
BEFORE DELETE ON veyra_voice_attachment_deliveries
BEGIN SELECT RAISE(ABORT,'voice attachment original cannot be deleted'); END;
CREATE TRIGGER veyra_voice_attachment_monotonic_time
BEFORE UPDATE OF updated_at ON veyra_voice_attachment_deliveries
WHEN NEW.updated_at<OLD.updated_at
BEGIN SELECT RAISE(ABORT,'voice attachment timestamp cannot move backwards'); END;
CREATE TRIGGER veyra_voice_attachment_identity_immutable
BEFORE UPDATE OF scope_hash,request_id,kind,scope_json,input_hash,original_message_id,created_at
ON veyra_voice_attachment_deliveries
BEGIN SELECT RAISE(ABORT,'voice attachment original is immutable'); END;
CREATE TRIGGER veyra_voice_attachment_transition
BEFORE UPDATE OF state,ack_kind,ack_hash,revision ON veyra_voice_attachment_deliveries
WHEN OLD.state<>'intent' OR NEW.state NOT IN ('ack','unknown') OR NEW.revision<>2
BEGIN SELECT RAISE(ABORT,'voice attachment original cannot replay or reopen'); END;
