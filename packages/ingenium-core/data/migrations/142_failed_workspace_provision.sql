-- A failed creation is negative custody only; it can never supply an original.
CREATE TABLE workspace_failed_provision_retirements (
 runtime_id TEXT PRIMARY KEY REFERENCES runtime_instances(id) ON DELETE RESTRICT,
 workspace_id TEXT NOT NULL REFERENCES authorized_workspaces(id) ON DELETE RESTRICT,
 public_request_json TEXT NOT NULL CHECK(json_valid(public_request_json) AND json_type(public_request_json)='object' AND length(CAST(public_request_json AS BLOB))<=8192),
 pod_uid TEXT NOT NULL CHECK(length(pod_uid)=36),
 namespace_uid TEXT NOT NULL CHECK(length(namespace_uid)=36),
 claim_uid TEXT NOT NULL CHECK(length(claim_uid)=36),
 spec_sha256 TEXT NOT NULL CHECK(length(spec_sha256)=64 AND spec_sha256 NOT GLOB '*[^0-9a-f]*'),
 observed_at INTEGER NOT NULL CHECK(observed_at>0),
 finished_at TEXT NOT NULL CHECK(julianday(finished_at) IS NOT NULL),
 proof_sha256 TEXT NOT NULL CHECK(length(proof_sha256)=64 AND proof_sha256 NOT GLOB '*[^0-9a-f]*')
) STRICT;
CREATE TRIGGER runtime142_failed_retirement_admission BEFORE INSERT ON workspace_failed_provision_retirements
 WHEN NOT EXISTS(SELECT 1 FROM runtime_instances r JOIN authorized_workspaces w ON w.id=r.workspace_id
 WHERE r.id=NEW.runtime_id AND r.schema_version=2 AND r.project_id IS NULL AND r.workspace_id=NEW.workspace_id
 AND r.state='FAILED' AND r.backend_container_id IS NULL AND r.active_connections=0 AND r.active_generations=0
 AND json_extract(NEW.public_request_json,'$.schemaVersion')=2 AND json_extract(NEW.public_request_json,'$.scopeKind')='workspace'
 AND json_extract(NEW.public_request_json,'$.runtimeId')=r.id AND json_extract(NEW.public_request_json,'$.workspaceId')=w.id
 AND json_extract(NEW.public_request_json,'$.organizationId')=r.organization_id AND json_extract(NEW.public_request_json,'$.ownerUserId')=r.owner_user_id
 AND json_extract(NEW.public_request_json,'$.storageMappingHash')=w.storage_mapping_hash AND json_extract(NEW.public_request_json,'$.securityEpoch')=r.security_epoch
 AND json_extract(NEW.public_request_json,'$.revision')=r.revision-1
 AND NOT EXISTS(SELECT 1 FROM runtime_original_provisions o WHERE o.runtime_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM runtime_capability_bindings c WHERE c.runtime_id=r.id AND c.revoked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM mcp_credentials c WHERE c.schema_version=2 AND c.workspace_id=w.id AND c.revoked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM runtime_browser_sessions b WHERE b.runtime_id=r.id AND b.revoked_at IS NULL))
 BEGIN SELECT RAISE(ABORT,'failed workspace creation must be withdrawn and absent'); END;
CREATE TRIGGER runtime142_failed_retirement_no_update BEFORE UPDATE ON workspace_failed_provision_retirements BEGIN SELECT RAISE(ABORT,'failed workspace creation history immutable'); END;
CREATE TRIGGER runtime142_failed_retirement_no_delete BEFORE DELETE ON workspace_failed_provision_retirements BEGIN SELECT RAISE(ABORT,'failed workspace creation history retained'); END;
CREATE TRIGGER runtime142_failed_retirement_no_replace BEFORE INSERT ON workspace_failed_provision_retirements
 WHEN EXISTS(SELECT 1 FROM workspace_failed_provision_retirements WHERE runtime_id=NEW.runtime_id)
 BEGIN SELECT RAISE(ABORT,'failed workspace creation history immutable'); END;