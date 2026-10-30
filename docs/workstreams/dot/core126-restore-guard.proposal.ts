import type { runtimes } from "ingenium-core";

export function hasActiveRuntimeForRestore(instances: readonly Pick<runtimes.RuntimeInstance, "state">[]): boolean {
  return instances.some((runtime) =>
    runtime.state !== "ABSENT" && runtime.state !== "STOPPED" && runtime.state !== "FAILED" && runtime.state !== "REVOKED");
}

/** Parent runtime state cannot establish retirement of an independently managed child.
 * The existing Core connection is read only here; no manager call, new writer or cleanup effect.
 */
export function hasUnretiredManagedExecutionForRestore(db: {prepare(sql:string):{get(...params:unknown[]):unknown}}): boolean {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_run_managed_execution'").get();
  if (!table) return false; // Legacy schema has never admitted this execution kind.
  const invalid = db.prepare(
    "SELECT 1 FROM job_run_managed_execution e LEFT JOIN job_runs r ON r.id=e.run_id " +
    "WHERE e.phase!='retired' OR r.id IS NULL OR r.status NOT IN ('success','failed','cancelled','timeout') " +
    "OR CASE WHEN json_valid(e.retirement_proof)=1 THEN NOT (" +
    "json_extract(e.retirement_proof,'$.schemaVersion')=1 " +
    "AND json_extract(e.retirement_proof,'$.runId')=e.run_id " +
    "AND json_extract(e.retirement_proof,'$.attemptId')=e.attempt_id " +
    "AND json_extract(e.retirement_proof,'$.specHash')=e.spec_hash AND (" +
    "(json_extract(e.retirement_proof,'$.kind')='original-daemon-container-wait-join' " +
    "AND json_extract(e.retirement_proof,'$.containerId')=e.original_container_id " +
    "AND json_extract(e.retirement_proof,'$.daemonId')=e.daemon_id " +
    "AND json_type(e.retirement_proof,'$.exitCode')='integer') " +
    "OR (e.original_container_id IS NULL AND e.effect_fence='closed-no-create-v1' AND e.material_consumed_at IS NULL AND e.credential_id IS NULL AND e.result_json IS NULL AND json_extract(e.retirement_proof,'$.kind')='core-no-create-effect-v1' " +
    "AND json_extract(e.retirement_proof,'$.effectFence')='closed-no-create-v1' " +
    "AND json_extract(e.retirement_proof,'$.runIdentityHash')=e.run_identity_hash AND json_type(e.retirement_proof,'$.closedRevision')='integer' AND json_extract(e.retirement_proof,'$.closedRevision')>=1 AND json_extract(e.retirement_proof,'$.closedRevision')<=e.revision AND julianday(json_extract(e.retirement_proof,'$.closedAt')) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM job_run_mcp_credentials c WHERE c.run_id=e.run_id)))) " +
    " ELSE 1 END IS NOT 0 LIMIT 1"
  ).get();
  return invalid !== undefined;
}
