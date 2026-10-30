-- Positive original-owner dispatch fence. No second run, writer, scheduler or execution grant.
-- Old unmarked operations are intentionally unchanged; no retrofit or data rewrite.
CREATE TABLE dot_original_dispatch_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL CHECK(schema_version=1));
INSERT INTO dot_original_dispatch_schema VALUES(1,1);
CREATE TRIGGER dot_dispatch_schema_no_update BEFORE UPDATE ON dot_original_dispatch_schema BEGIN SELECT RAISE(ABORT,'Dot dispatch schema marker is immutable'); END;
CREATE TRIGGER dot_dispatch_schema_no_delete BEFORE DELETE ON dot_original_dispatch_schema BEGIN SELECT RAISE(ABORT,'Dot dispatch schema marker is immutable'); END;

CREATE TRIGGER dot_dispatch_initial BEFORE INSERT ON veyra_dot_records
WHEN json_type(NEW.body,'$.managedDispatch') IS NOT NULL
BEGIN
 SELECT CASE WHEN COALESCE(
  NEW.kind='operation' AND json_type(NEW.body,'$.managedDispatch')='object'
  AND (SELECT count(*) FROM json_each(NEW.body,'$.managedDispatch'))=3
  AND json_extract(NEW.body,'$.managedDispatch.protocol') IN ('core126-original-v1','core126-candidate-original-v1')
  AND json_extract(NEW.body,'$.managedDispatch.fence')='not-admitted-v1'
  AND json_type(NEW.body,'$.managedDispatch.runIdentityHash')='text'
  AND length(json_extract(NEW.body,'$.managedDispatch.runIdentityHash'))=64
  AND json_extract(NEW.body,'$.managedDispatch.runIdentityHash') NOT GLOB '*[^0-9a-f]*'
  AND json_extract(NEW.body,'$.state')='claimed'
  AND json_extract(NEW.body,'$.id')=NEW.id
  AND json_extract(NEW.body,'$.revision')=NEW.revision
  AND NEW.scope_key=json_array(json_extract(NEW.body,'$.scope.organizationId'),json_extract(NEW.body,'$.scope.ownerUserId'),json_extract(NEW.body,'$.scope.projectId'),json_extract(NEW.body,'$.scope.executionBindingId'),json_extract(NEW.body,'$.scope.executionBindingFingerprint'),json_extract(NEW.body,'$.scope.conversationId'))
  AND json_extract(NEW.body,'$.scope.organizationId')=NEW.organization_id
  AND json_extract(NEW.body,'$.scope.ownerUserId')=NEW.owner_user_id
  AND EXISTS(SELECT 1 FROM job_runs r JOIN veyra_dot_records f ON f.kind='followup' AND f.id=json_extract(NEW.body,'$.followupId')
   WHERE r.id=json_extract(NEW.body,'$.runId') AND r.status IN ('queued','running') AND r.trigger='cron'
    AND f.scope_key=NEW.scope_key AND f.organization_id=NEW.organization_id AND f.owner_user_id=NEW.owner_user_id
    AND json_extract(f.body,'$.state')='active' AND r.job_id=json_extract(f.body,'$.jobId')
    AND r.project_id=json_extract(NEW.body,'$.scope.projectId') AND r.organization_id=NEW.organization_id
    AND r.job_revision=json_extract(f.body,'$.jobRevision') AND r.schedule_revision=json_extract(f.body,'$.scheduleRevision')
    AND r.scheduled_for=json_extract(NEW.body,'$.scheduledFor'))
  AND NOT EXISTS(SELECT 1 FROM job_run_managed_execution e WHERE e.run_id=json_extract(NEW.body,'$.runId'))
  AND NOT EXISTS(SELECT 1 FROM veyra_dot_records o WHERE o.kind='operation' AND json_extract(o.body,'$.runId')=json_extract(NEW.body,'$.runId'))
 ,0)=0 THEN RAISE(ABORT,'Dot original dispatch claim required') END;
END;

CREATE TRIGGER dot_dispatch_retry_claim BEFORE UPDATE ON veyra_dot_records
WHEN json_type(OLD.body,'$.managedDispatch') IS NULL AND json_type(NEW.body,'$.managedDispatch') IS NOT NULL
BEGIN
 SELECT CASE WHEN COALESCE(
  OLD.kind='operation' AND NEW.kind=OLD.kind AND NEW.id=OLD.id AND NEW.organization_id=OLD.organization_id AND NEW.owner_user_id=OLD.owner_user_id AND NEW.scope_key=OLD.scope_key
  AND NEW.revision=OLD.revision+1 AND json_extract(OLD.body,'$.state')='blocked' AND json_extract(OLD.body,'$.runId') IS NULL
  AND json_extract(OLD.body,'$.code') LIKE 'WAIT_CAPACITY:%'
  AND json_extract(NEW.body,'$.followupId') IS json_extract(OLD.body,'$.followupId')
  AND json_extract(NEW.body,'$.scope') IS json_extract(OLD.body,'$.scope')
  AND json_extract(NEW.body,'$.scheduledFor') IS json_extract(OLD.body,'$.scheduledFor')
  AND NEW.kind='operation' AND json_type(NEW.body,'$.managedDispatch')='object'
  AND (SELECT count(*) FROM json_each(NEW.body,'$.managedDispatch'))=3
  AND json_extract(NEW.body,'$.managedDispatch.protocol') IN ('core126-original-v1','core126-candidate-original-v1')
  AND json_extract(NEW.body,'$.managedDispatch.fence')='not-admitted-v1'
  AND json_type(NEW.body,'$.managedDispatch.runIdentityHash')='text'
  AND length(json_extract(NEW.body,'$.managedDispatch.runIdentityHash'))=64
  AND json_extract(NEW.body,'$.managedDispatch.runIdentityHash') NOT GLOB '*[^0-9a-f]*'
  AND json_extract(NEW.body,'$.state')='claimed'
  AND json_extract(NEW.body,'$.id')=NEW.id
  AND json_extract(NEW.body,'$.revision')=NEW.revision
  AND NEW.scope_key=json_array(json_extract(NEW.body,'$.scope.organizationId'),json_extract(NEW.body,'$.scope.ownerUserId'),json_extract(NEW.body,'$.scope.projectId'),json_extract(NEW.body,'$.scope.executionBindingId'),json_extract(NEW.body,'$.scope.executionBindingFingerprint'),json_extract(NEW.body,'$.scope.conversationId'))
  AND json_extract(NEW.body,'$.scope.organizationId')=NEW.organization_id
  AND json_extract(NEW.body,'$.scope.ownerUserId')=NEW.owner_user_id
  AND EXISTS(SELECT 1 FROM job_runs r JOIN veyra_dot_records f ON f.kind='followup' AND f.id=json_extract(NEW.body,'$.followupId')
   WHERE r.id=json_extract(NEW.body,'$.runId') AND r.status IN ('queued','running') AND r.trigger='cron'
    AND f.scope_key=NEW.scope_key AND f.organization_id=NEW.organization_id AND f.owner_user_id=NEW.owner_user_id
    AND json_extract(f.body,'$.state')='active' AND r.job_id=json_extract(f.body,'$.jobId')
    AND r.project_id=json_extract(NEW.body,'$.scope.projectId') AND r.organization_id=NEW.organization_id
    AND r.job_revision=json_extract(f.body,'$.jobRevision') AND r.schedule_revision=json_extract(f.body,'$.scheduleRevision')
    AND r.scheduled_for=json_extract(NEW.body,'$.scheduledFor'))
  AND NOT EXISTS(SELECT 1 FROM job_run_managed_execution e WHERE e.run_id=json_extract(NEW.body,'$.runId'))
  AND NOT EXISTS(SELECT 1 FROM veyra_dot_records o WHERE o.kind='operation' AND o.id!=OLD.id AND json_extract(o.body,'$.runId')=json_extract(NEW.body,'$.runId'))
 ,0)=0 THEN RAISE(ABORT,'Dot original dispatch claim required') END;
END;

CREATE TRIGGER dot_dispatch_monotonic BEFORE UPDATE ON veyra_dot_records
WHEN json_type(OLD.body,'$.managedDispatch') IS NOT NULL
BEGIN
 SELECT CASE WHEN COALESCE(
  OLD.kind='operation' AND NEW.kind=OLD.kind AND NEW.id=OLD.id
  AND NEW.organization_id=OLD.organization_id AND NEW.owner_user_id=OLD.owner_user_id AND NEW.scope_key=OLD.scope_key
  AND NEW.revision=OLD.revision+1 AND json_extract(NEW.body,'$.revision')=NEW.revision
  AND json_type(OLD.body,'$.managedDispatch')='object' AND json_type(NEW.body,'$.managedDispatch')='object'
  AND (SELECT count(*) FROM json_each(NEW.body,'$.managedDispatch'))=3
  AND json_extract(NEW.body,'$.managedDispatch.protocol') IS json_extract(OLD.body,'$.managedDispatch.protocol')
  AND json_extract(NEW.body,'$.managedDispatch.runIdentityHash') IS json_extract(OLD.body,'$.managedDispatch.runIdentityHash')
  AND json_extract(NEW.body,'$.id') IS json_extract(OLD.body,'$.id')
  AND json_extract(NEW.body,'$.runId') IS json_extract(OLD.body,'$.runId')
  AND json_extract(NEW.body,'$.followupId') IS json_extract(OLD.body,'$.followupId')
  AND json_extract(NEW.body,'$.scheduledFor') IS json_extract(OLD.body,'$.scheduledFor')
  AND json_extract(NEW.body,'$.scope') IS json_extract(OLD.body,'$.scope')
  AND (
   (json_extract(NEW.body,'$.managedDispatch.fence')=json_extract(OLD.body,'$.managedDispatch.fence')
     AND (json_extract(OLD.body,'$.managedDispatch.fence')!='closed-unadmitted-v1'
      OR (json_extract(NEW.body,'$.state')='cancelled' AND json_extract(NEW.body,'$.code') IS json_extract(OLD.body,'$.code') AND json_extract(NEW.body,'$.updatedAt') IS json_extract(OLD.body,'$.updatedAt'))))
   OR (json_extract(OLD.body,'$.managedDispatch.fence')='not-admitted-v1'
     AND json_extract(NEW.body,'$.managedDispatch.fence')='core-owner-admitted-v1'
     AND EXISTS(SELECT 1 FROM job_run_managed_execution e WHERE e.run_id=json_extract(OLD.body,'$.runId') AND e.run_identity_hash=json_extract(OLD.body,'$.managedDispatch.runIdentityHash') AND e.project_id=json_extract(OLD.body,'$.scope.projectId') AND e.organization_id=OLD.organization_id AND e.owner_user_id=OLD.owner_user_id AND e.workspace_id=json_extract(OLD.body,'$.scope.executionBindingId') AND e.purpose=CASE json_extract(OLD.body,'$.managedDispatch.protocol') WHEN 'core126-original-v1' THEN 'production' WHEN 'core126-candidate-original-v1' THEN 'candidate-inert-v1' END))
   OR (json_extract(OLD.body,'$.managedDispatch.fence')='not-admitted-v1'
     AND json_extract(NEW.body,'$.managedDispatch.fence')='closed-unadmitted-v1'
     AND json_extract(NEW.body,'$.state')='cancelled'
     AND json_extract(NEW.body,'$.code')='CORE126_ORIGINAL_UNADMITTED_CLOSED'
     AND EXISTS(SELECT 1 FROM job_runs r WHERE r.id=json_extract(OLD.body,'$.runId') AND r.status='cancelled' AND r.finished_at IS NOT NULL)
     AND NOT EXISTS(SELECT 1 FROM job_run_managed_execution e WHERE e.run_id=json_extract(OLD.body,'$.runId')))
  )
 ,0)=0 THEN RAISE(ABORT,'Dot original dispatch fence is monotonic') END;
END;
CREATE TRIGGER dot_dispatch_no_delete BEFORE DELETE ON veyra_dot_records
WHEN json_type(OLD.body,'$.managedDispatch') IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Original Dot dispatch evidence is retained'); END;

CREATE TRIGGER dot_dispatch_admission BEFORE INSERT ON job_run_managed_execution
WHEN EXISTS(SELECT 1 FROM veyra_dot_records o WHERE o.kind='operation' AND json_extract(o.body,'$.runId')=NEW.run_id AND json_type(o.body,'$.managedDispatch') IS NOT NULL)
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM veyra_dot_records o JOIN veyra_dot_records f ON f.kind='followup' AND f.id=json_extract(o.body,'$.followupId')
  WHERE o.kind='operation' AND json_extract(o.body,'$.runId')=NEW.run_id
   AND json_extract(o.body,'$.managedDispatch.protocol') IN ('core126-original-v1','core126-candidate-original-v1')
   AND json_extract(o.body,'$.managedDispatch.fence')='not-admitted-v1'
   AND json_extract(o.body,'$.managedDispatch.runIdentityHash')=NEW.run_identity_hash
   AND NEW.purpose=CASE json_extract(o.body,'$.managedDispatch.protocol') WHEN 'core126-original-v1' THEN 'production' WHEN 'core126-candidate-original-v1' THEN 'candidate-inert-v1' END AND NEW.effect_fence='open-v1' AND NEW.phase='prepared'
   AND NEW.original_container_id IS NULL AND NEW.material_consumed_at IS NULL AND NEW.credential_id IS NULL
   AND o.organization_id=NEW.organization_id AND o.owner_user_id=NEW.owner_user_id
   AND json_extract(o.body,'$.scope.projectId')=NEW.project_id AND json_extract(o.body,'$.scope.executionBindingId')=NEW.workspace_id
   AND f.scope_key=o.scope_key AND f.organization_id=o.organization_id AND f.owner_user_id=o.owner_user_id
   AND json_extract(f.body,'$.state')='active' AND json_extract(o.body,'$.state') IN ('claimed','running')
   AND json_extract(f.body,'$.jobId')=NEW.job_id AND json_extract(f.body,'$.jobRevision')=NEW.job_revision
   AND json_extract(f.body,'$.scheduleRevision')=NEW.schedule_revision)
 THEN RAISE(ABORT,'Original open Dot dispatch admission required') END;
END;
CREATE TRIGGER dot_dispatch_record_admission AFTER INSERT ON job_run_managed_execution
BEGIN
 UPDATE veyra_dot_records SET revision=revision+1,body=json_set(body,'$.revision',revision+1,'$.managedDispatch.fence','core-owner-admitted-v1')
 WHERE kind='operation' AND json_extract(body,'$.runId')=NEW.run_id AND json_extract(body,'$.managedDispatch.protocol') IN ('core126-original-v1','core126-candidate-original-v1');
END;
CREATE TRIGGER dot_dispatch_admitted_no_delete BEFORE DELETE ON job_run_managed_execution
WHEN EXISTS(SELECT 1 FROM veyra_dot_records o WHERE o.kind='operation' AND json_extract(o.body,'$.runId')=OLD.run_id AND json_type(o.body,'$.managedDispatch') IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Original admitted Dot execution is retained'); END;
CREATE TRIGGER dot_dispatch_run_identity BEFORE UPDATE ON job_runs
WHEN EXISTS(SELECT 1 FROM veyra_dot_records o WHERE o.kind='operation' AND json_extract(o.body,'$.runId')=OLD.id AND json_type(o.body,'$.managedDispatch') IS NOT NULL)
 AND (NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.project_id IS NOT OLD.project_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.effective_service_principal_id IS NOT OLD.effective_service_principal_id OR NEW.job_revision IS NOT OLD.job_revision
  OR NEW.schedule_revision IS NOT OLD.schedule_revision OR NEW.authorization_revision IS NOT OLD.authorization_revision OR NEW.trigger IS NOT OLD.trigger
  OR NEW.scheduled_for IS NOT OLD.scheduled_for OR NEW.created_at IS NOT OLD.created_at
  OR (EXISTS(SELECT 1 FROM veyra_dot_records o WHERE o.kind='operation' AND json_extract(o.body,'$.runId')=OLD.id AND json_extract(o.body,'$.managedDispatch.fence')='closed-unadmitted-v1') AND (NEW.status IS NOT OLD.status OR NEW.finished_at IS NOT OLD.finished_at)))
BEGIN SELECT RAISE(ABORT,'Original fenced Dot Run identity is immutable'); END;

CREATE TRIGGER dot_dispatch_run_no_delete BEFORE DELETE ON job_runs
WHEN EXISTS(SELECT 1 FROM veyra_dot_records o WHERE o.kind='operation' AND json_extract(o.body,'$.runId')=OLD.id AND json_type(o.body,'$.managedDispatch') IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Original fenced Dot Run is retained'); END;

-- REPLACE may not invoke DELETE triggers when recursive_triggers is OFF.
-- BEFORE INSERT collision guards preserve original evidence independently of
-- connection-local recursion settings, including replacement with unmarked JSON.
CREATE TRIGGER dot_dispatch_record_collision BEFORE INSERT ON veyra_dot_records
WHEN EXISTS(SELECT 1 FROM veyra_dot_records o WHERE o.kind=NEW.kind AND o.id=NEW.id AND json_type(o.body,'$.managedDispatch') IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Original fenced Dot operation cannot be replaced'); END;
CREATE TRIGGER dot_dispatch_run_collision BEFORE INSERT ON job_runs
WHEN EXISTS(SELECT 1 FROM job_runs r JOIN veyra_dot_records o ON o.kind='operation' AND json_extract(o.body,'$.runId')=r.id AND json_type(o.body,'$.managedDispatch') IS NOT NULL WHERE r.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Original fenced Dot Run cannot be replaced'); END;
