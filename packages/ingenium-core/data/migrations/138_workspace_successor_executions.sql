-- Original runtime rows and all references survive. Legacy uniqueness is unchanged.
CREATE UNIQUE INDEX runtime138_legacy_workspace ON runtime_instances(workspace_id) WHERE schema_version=1;
CREATE UNIQUE INDEX runtime138_active_workspace ON runtime_instances(workspace_id) WHERE schema_version=2 AND state NOT IN ('STOPPED','FAILED','REVOKED');
CREATE TABLE workspace_execution_generations (
 runtime_id TEXT PRIMARY KEY REFERENCES runtime_instances(id) ON DELETE RESTRICT,
 workspace_id TEXT NOT NULL REFERENCES authorized_workspaces(id) ON DELETE RESTRICT,
 generation INTEGER NOT NULL CHECK(generation>=1),
 UNIQUE(workspace_id,generation)
) STRICT;
INSERT INTO workspace_execution_generations(runtime_id,workspace_id,generation)
 SELECT id,workspace_id,1 FROM runtime_instances WHERE schema_version=2;
CREATE TABLE workspace_execution_retirements (
 runtime_id TEXT PRIMARY KEY REFERENCES runtime_instances(id) ON DELETE RESTRICT,
 workspace_id TEXT NOT NULL REFERENCES authorized_workspaces(id) ON DELETE RESTRICT,
 parent_container_id TEXT NOT NULL CHECK(length(parent_container_id)=64 AND parent_container_id NOT GLOB '*[^0-9a-f]*'),
 daemon_id TEXT NOT NULL CHECK(length(daemon_id) BETWEEN 1 AND 256),
 start_identity TEXT NOT NULL CHECK(length(start_identity)=64 AND start_identity NOT GLOB '*[^0-9a-f]*'),
 public_profile_sha256 TEXT NOT NULL CHECK(length(public_profile_sha256)=64 AND public_profile_sha256 NOT GLOB '*[^0-9a-f]*'),
 original_request_sha256 TEXT NOT NULL CHECK(length(original_request_sha256)=64 AND original_request_sha256 NOT GLOB '*[^0-9a-f]*'),
 observed_at INTEGER NOT NULL CHECK(observed_at>0),
 finished_at TEXT NOT NULL CHECK(julianday(finished_at) IS NOT NULL),
 proof_sha256 TEXT NOT NULL CHECK(length(proof_sha256)=64 AND proof_sha256 NOT GLOB '*[^0-9a-f]*')
) STRICT;
CREATE TRIGGER runtime138_successor_admission BEFORE INSERT ON runtime_instances
 WHEN NEW.schema_version=2 AND EXISTS(
 SELECT 1 FROM runtime_instances old WHERE old.workspace_id=NEW.workspace_id AND
 (old.schema_version<>2 OR old.state NOT IN ('STOPPED','FAILED','REVOKED') OR NOT EXISTS(
  SELECT 1 FROM workspace_execution_retirements proof WHERE proof.runtime_id=old.id AND proof.workspace_id=old.workspace_id)))
 BEGIN SELECT RAISE(ABORT,'workspace predecessor retirement required'); END;
CREATE TRIGGER runtime138_generation_insert AFTER INSERT ON runtime_instances WHEN NEW.schema_version=2
 BEGIN INSERT INTO workspace_execution_generations(runtime_id,workspace_id,generation)
 VALUES(NEW.id,NEW.workspace_id,COALESCE((SELECT MAX(generation) FROM workspace_execution_generations WHERE workspace_id=NEW.workspace_id),0)+1); END;
CREATE TRIGGER runtime138_no_reprovision BEFORE UPDATE ON runtime_instances
 WHEN OLD.schema_version=2 AND NEW.state='PROVISIONING' AND NEW.state<>OLD.state AND OLD.state<>'ABSENT'
 BEGIN SELECT RAISE(ABORT,'new workspace execution identity required'); END;
CREATE TRIGGER runtime138_no_delete BEFORE DELETE ON runtime_instances WHEN OLD.schema_version=2
 BEGIN SELECT RAISE(ABORT,'workspace execution history retained'); END;
CREATE TRIGGER runtime138_retirement_admission BEFORE INSERT ON workspace_execution_retirements
 WHEN NOT EXISTS(SELECT 1 FROM runtime_instances r JOIN runtime_original_provisions o ON o.runtime_id=r.id
 WHERE r.id=NEW.runtime_id AND r.schema_version=2 AND r.project_id IS NULL AND r.workspace_id=NEW.workspace_id
 AND r.state IN ('STOPPED','FAILED','REVOKED') AND r.active_connections=0 AND r.active_generations=0
 AND r.backend_container_id=NEW.parent_container_id AND o.parent_container_id=NEW.parent_container_id
 AND o.schema_version=2 AND o.project_id IS NULL AND o.workspace_id=NEW.workspace_id
 AND o.daemon_id=NEW.daemon_id AND o.start_identity=NEW.start_identity
 AND o.public_profile_sha256=NEW.public_profile_sha256 AND o.request_sha256=NEW.original_request_sha256
 AND NOT EXISTS(SELECT 1 FROM runtime_capability_bindings c WHERE c.runtime_id=r.id AND c.revoked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM runtime_browser_sessions b WHERE b.runtime_id=r.id AND b.revoked_at IS NULL))
 BEGIN SELECT RAISE(ABORT,'original stopped workspace retirement required'); END;
CREATE TRIGGER runtime138_workspace_execution_generations_update BEFORE UPDATE ON workspace_execution_generations BEGIN SELECT RAISE(ABORT,'workspace execution receipt immutable'); END;
CREATE TRIGGER runtime138_workspace_execution_generations_delete BEFORE DELETE ON workspace_execution_generations BEGIN SELECT RAISE(ABORT,'workspace execution receipt immutable'); END;
CREATE TRIGGER runtime138_workspace_execution_retirements_update BEFORE UPDATE ON workspace_execution_retirements BEGIN SELECT RAISE(ABORT,'workspace execution receipt immutable'); END;
CREATE TRIGGER runtime138_workspace_execution_retirements_delete BEFORE DELETE ON workspace_execution_retirements BEGIN SELECT RAISE(ABORT,'workspace execution receipt immutable'); END;
CREATE TRIGGER runtime138_generation_admission BEFORE INSERT ON workspace_execution_generations
 WHEN EXISTS(SELECT 1 FROM workspace_execution_generations g WHERE g.runtime_id=NEW.runtime_id OR (g.workspace_id=NEW.workspace_id AND g.generation=NEW.generation))
 OR NOT EXISTS(SELECT 1 FROM runtime_instances r WHERE r.id=NEW.runtime_id AND r.workspace_id=NEW.workspace_id AND r.schema_version=2 AND r.project_id IS NULL)
 OR NEW.generation<>COALESCE((SELECT MAX(generation) FROM workspace_execution_generations WHERE workspace_id=NEW.workspace_id),0)+1
 BEGIN SELECT RAISE(ABORT,'original workspace generation required'); END;
CREATE TRIGGER runtime138_retirement_no_replace BEFORE INSERT ON workspace_execution_retirements
 WHEN EXISTS(SELECT 1 FROM workspace_execution_retirements WHERE runtime_id=NEW.runtime_id)
 BEGIN SELECT RAISE(ABORT,'workspace retirement immutable'); END;
