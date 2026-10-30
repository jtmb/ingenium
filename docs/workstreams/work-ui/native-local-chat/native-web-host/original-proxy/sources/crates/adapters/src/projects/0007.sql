-- Native allocation 7. Original ProjectStore transaction only. No new writer.
-- BEFORE INSERT guards are essential: REPLACE can suppress DELETE triggers
-- with recursive_triggers=OFF, even while foreign_keys=ON.
CREATE TRIGGER local_installation_no_replace BEFORE INSERT ON local_installation
WHEN EXISTS(SELECT 1 FROM local_installation WHERE singleton=NEW.singleton OR installation_id=NEW.installation_id OR custodian_key=NEW.custodian_key)
BEGIN SELECT RAISE(ABORT,'local installation replacement refused'); END;
CREATE TRIGGER local_migration_receipts_no_replace BEFORE INSERT ON local_migration_receipts
WHEN EXISTS(SELECT 1 FROM local_migration_receipts WHERE version=NEW.version)
BEGIN SELECT RAISE(ABORT,'local migration replacement refused'); END;
CREATE TRIGGER local_workspace_no_replace BEFORE INSERT ON local_workspaces
WHEN EXISTS(SELECT 1 FROM local_workspaces WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'local workspace replacement refused'); END;
CREATE TRIGGER local_operation_no_replace BEFORE INSERT ON local_workspace_operations
WHEN EXISTS(SELECT 1 FROM local_workspace_operations WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'local operation replacement refused'); END;

-- Minimal immutable identity ledger survives explicit payload forgetting.
-- stable_key is NULL for genuinely no-ID operations, never content-derived.
CREATE TABLE local_web_original_keys (
 operation_id TEXT PRIMARY KEY NOT NULL,
 stable_key TEXT UNIQUE,
 input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
 effective_sha256 TEXT NOT NULL CHECK(length(effective_sha256)=64),
 intake_bytes INTEGER NOT NULL CHECK(intake_bytes BETWEEN 0 AND 16777216),
 retained_bytes INTEGER NOT NULL CHECK(retained_bytes BETWEEN intake_bytes AND 67108864),
 FOREIGN KEY(operation_id) REFERENCES local_workspace_operations(id)
);
CREATE TABLE local_web_original_payloads (
 operation_id TEXT PRIMARY KEY NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('POST','PUT','PATCH','DELETE')),
 raw_target TEXT NOT NULL,
 content_headers_json TEXT NOT NULL,
 scope_engine_json TEXT NOT NULL,
 raw_body BLOB NOT NULL,
 effective_body BLOB NOT NULL CHECK(length(effective_body)<=16777216),
 transformations_json TEXT NOT NULL CHECK(length(CAST(transformations_json AS BLOB))<=65536),
 files_original_json TEXT NOT NULL CHECK(length(CAST(files_original_json AS BLOB))<=16777216),
 FOREIGN KEY(operation_id) REFERENCES local_web_original_keys(operation_id)
);
CREATE TABLE local_web_original_forget_receipts (
 operation_id TEXT PRIMARY KEY NOT NULL,
 input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
 forget_request_id TEXT NOT NULL UNIQUE,
 FOREIGN KEY(operation_id) REFERENCES local_web_original_keys(operation_id)
);
-- Captured source bytes are BLOBs, content-addressed inside this SAME original
-- operation/writer. JSON maps retain only hashes/selection/path identities.
CREATE TABLE local_web_original_sources (
 operation_id TEXT NOT NULL,
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 source_bytes BLOB NOT NULL CHECK(length(source_bytes)<=8388608),
 PRIMARY KEY(operation_id,source_sha256),
 FOREIGN KEY(operation_id) REFERENCES local_web_original_payloads(operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE local_web_original_acknowledgements (
 operation_id TEXT PRIMARY KEY NOT NULL,
 input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
 status INTEGER NOT NULL CHECK(status BETWEEN 100 AND 599 AND status NOT BETWEEN 300 AND 399),
 content_headers_json TEXT NOT NULL CHECK(length(CAST(content_headers_json AS BLOB))<=16384),
 body_sha256 TEXT NOT NULL CHECK(length(body_sha256)=64),
 body BLOB NOT NULL CHECK(length(body)<=16777216),
 retained_bytes INTEGER NOT NULL CHECK(retained_bytes=length(CAST(content_headers_json AS BLOB))+length(body)+64),
 FOREIGN KEY(operation_id) REFERENCES local_web_original_payloads(operation_id)
);
CREATE TRIGGER local_web_keys_insert_guard BEFORE INSERT ON local_web_original_keys
WHEN EXISTS(SELECT 1 FROM local_web_original_keys WHERE operation_id=NEW.operation_id OR (NEW.stable_key IS NOT NULL AND stable_key=NEW.stable_key))
 OR NOT EXISTS(SELECT 1 FROM local_workspace_operations WHERE id=NEW.operation_id AND kind='native_web_original' AND state='intent' AND request_sha256=NEW.input_sha256)
 OR (SELECT count(*) FROM local_web_original_keys)>=4096
BEGIN SELECT RAISE(ABORT,'Web original key or original operation refused'); END;
CREATE TRIGGER local_web_keys_no_update BEFORE UPDATE ON local_web_original_keys
BEGIN SELECT RAISE(ABORT,'Web original identity is immutable'); END;
CREATE TRIGGER local_web_keys_no_delete BEFORE DELETE ON local_web_original_keys
BEGIN SELECT RAISE(ABORT,'Web original identity must survive forgetting'); END;
CREATE TRIGGER local_web_payload_insert_guard BEFORE INSERT ON local_web_original_payloads
WHEN EXISTS(SELECT 1 FROM local_web_original_payloads WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM local_web_original_forget_receipts WHERE operation_id=NEW.operation_id)
 OR NOT EXISTS(SELECT 1 FROM local_web_original_keys k JOIN local_workspace_operations o ON o.id=k.operation_id
   WHERE k.operation_id=NEW.operation_id AND o.kind='native_web_original' AND o.state='intent'
   AND k.intake_bytes=length(CAST(NEW.method AS BLOB))+length(CAST(NEW.raw_target AS BLOB))+length(CAST(NEW.content_headers_json AS BLOB))+length(CAST(NEW.scope_engine_json AS BLOB))+length(NEW.raw_body)
   AND k.retained_bytes=k.intake_bytes+length(NEW.effective_body)+length(CAST(NEW.transformations_json AS BLOB))+length(CAST(NEW.files_original_json AS BLOB))
     +(SELECT COALESCE(sum(length(source_bytes)+64),0) FROM local_web_original_sources WHERE operation_id=NEW.operation_id))
 OR (SELECT COALESCE(sum(k.retained_bytes+COALESCE(a.retained_bytes,16793664)),0) FROM local_web_original_keys k JOIN local_web_original_payloads p ON p.operation_id=k.operation_id LEFT JOIN local_web_original_acknowledgements a ON a.operation_id=k.operation_id)
   +(SELECT retained_bytes FROM local_web_original_keys WHERE operation_id=NEW.operation_id)+16793664>67108864
BEGIN SELECT RAISE(ABORT,'Web original payload replacement or retention budget refused'); END;
CREATE TRIGGER local_web_payload_no_update BEFORE UPDATE ON local_web_original_payloads
BEGIN SELECT RAISE(ABORT,'Web original payload is immutable'); END;
CREATE TRIGGER local_web_payload_delete_guard BEFORE DELETE ON local_web_original_payloads
WHEN NOT EXISTS(SELECT 1 FROM local_web_original_forget_receipts f JOIN local_web_original_keys k ON k.operation_id=f.operation_id
 JOIN local_workspace_operations o ON o.id=k.operation_id WHERE f.operation_id=OLD.operation_id
 AND f.input_sha256=k.input_sha256 AND o.state IN ('committed','denied'))
BEGIN SELECT RAISE(ABORT,'Web original needs exact explicit terminal forgetting receipt'); END;
CREATE TRIGGER local_web_forget_insert_guard BEFORE INSERT ON local_web_original_forget_receipts
WHEN EXISTS(SELECT 1 FROM local_web_original_forget_receipts WHERE operation_id=NEW.operation_id OR forget_request_id=NEW.forget_request_id)
 OR NOT EXISTS(SELECT 1 FROM local_web_original_keys k JOIN local_workspace_operations o ON o.id=k.operation_id
 WHERE k.operation_id=NEW.operation_id AND k.input_sha256=NEW.input_sha256 AND o.state IN ('committed','denied'))
BEGIN SELECT RAISE(ABORT,'Web original forgetting refused for unknown or conflicting original'); END;
CREATE TRIGGER local_web_forget_no_update BEFORE UPDATE ON local_web_original_forget_receipts
BEGIN SELECT RAISE(ABORT,'Web original forgetting receipt is immutable'); END;
CREATE TRIGGER local_web_forget_no_delete BEFORE DELETE ON local_web_original_forget_receipts
BEGIN SELECT RAISE(ABORT,'Web original forgetting receipt must survive'); END;
CREATE TRIGGER local_web_sources_insert_guard BEFORE INSERT ON local_web_original_sources
WHEN EXISTS(SELECT 1 FROM local_web_original_sources WHERE operation_id=NEW.operation_id AND source_sha256=NEW.source_sha256)
 OR EXISTS(SELECT 1 FROM local_web_original_payloads WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM local_web_original_forget_receipts WHERE operation_id=NEW.operation_id)
 OR NOT EXISTS(SELECT 1 FROM local_web_original_keys k JOIN local_workspace_operations o ON o.id=k.operation_id WHERE k.operation_id=NEW.operation_id AND o.kind='native_web_original' AND o.state='intent')
BEGIN SELECT RAISE(ABORT,'Web captured source replacement or late insertion refused'); END;
CREATE TRIGGER local_web_sources_no_update BEFORE UPDATE ON local_web_original_sources
BEGIN SELECT RAISE(ABORT,'Web captured source is immutable'); END;
CREATE TRIGGER local_web_sources_delete_guard BEFORE DELETE ON local_web_original_sources
WHEN NOT EXISTS(SELECT 1 FROM local_web_original_forget_receipts f JOIN local_web_original_keys k ON k.operation_id=f.operation_id JOIN local_workspace_operations o ON o.id=k.operation_id WHERE f.operation_id=OLD.operation_id AND f.input_sha256=k.input_sha256 AND o.state IN ('committed','denied'))
BEGIN SELECT RAISE(ABORT,'Web captured source requires explicit terminal forgetting'); END;
CREATE TRIGGER local_web_ack_insert_guard BEFORE INSERT ON local_web_original_acknowledgements
WHEN EXISTS(SELECT 1 FROM local_web_original_acknowledgements WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM local_web_original_forget_receipts WHERE operation_id=NEW.operation_id)
 OR NOT EXISTS(SELECT 1 FROM local_web_original_keys k JOIN local_workspace_operations o ON o.id=k.operation_id WHERE k.operation_id=NEW.operation_id AND k.input_sha256=NEW.input_sha256 AND o.kind='native_web_original' AND o.state='unknown')
 OR NEW.retained_bytes>16793664
 OR (SELECT COALESCE(sum(k.retained_bytes+CASE WHEN k.operation_id=NEW.operation_id THEN NEW.retained_bytes ELSE COALESCE(a.retained_bytes,16793664) END),0) FROM local_web_original_keys k JOIN local_web_original_payloads p ON p.operation_id=k.operation_id LEFT JOIN local_web_original_acknowledgements a ON a.operation_id=k.operation_id)>67108864
BEGIN SELECT RAISE(ABORT,'Web acknowledgement replacement, owner or retention budget refused'); END;
CREATE TRIGGER local_web_ack_no_update BEFORE UPDATE ON local_web_original_acknowledgements
BEGIN SELECT RAISE(ABORT,'Web original acknowledgement is immutable'); END;
CREATE TRIGGER local_web_ack_delete_guard BEFORE DELETE ON local_web_original_acknowledgements
WHEN NOT EXISTS(SELECT 1 FROM local_web_original_forget_receipts f JOIN local_web_original_keys k ON k.operation_id=f.operation_id JOIN local_workspace_operations o ON o.id=k.operation_id WHERE f.operation_id=OLD.operation_id AND f.input_sha256=k.input_sha256 AND o.state IN ('committed','denied'))
BEGIN SELECT RAISE(ABORT,'Web acknowledgement requires explicit terminal forgetting'); END;
PRAGMA user_version=7;
