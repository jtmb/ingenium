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
  const candidateProtocol = !!db.prepare("SELECT 1 FROM pragma_table_info('job_run_managed_execution') WHERE name='candidate_waiting_protocol'").get();
  if(candidateProtocol){
    //131's base never leaves prepared. Read only its exact retained extension;
    // a terminal Run, parent health, absent row or elapsed time is insufficient.
    const candidate=db.prepare(
      "SELECT 1 FROM job_run_managed_execution e LEFT JOIN job_run_candidate_lifecycle c " +
      "ON c.run_id=e.run_id AND c.attempt_id=e.attempt_id AND c.spec_hash=e.spec_hash AND c.candidate_intent_hash=e.candidate_intent_hash " +
      "LEFT JOIN job_runs r ON r.id=e.run_id WHERE e.candidate_waiting_protocol='original-candidate-waiting-v1' AND (" +
      "e.purpose!='candidate-inert-v1' OR c.run_id IS NULL OR c.phase!='retired' OR r.id IS NULL " +
      "OR r.status NOT IN ('success','failed','cancelled','timeout') OR CASE WHEN json_valid(c.retirement_json)=1 THEN NOT (" +
      "json_extract(c.retirement_json,'$.schemaVersion')=1 AND json_extract(c.retirement_json,'$.runId')=e.run_id " +
      "AND json_extract(c.retirement_json,'$.attemptId')=e.attempt_id AND json_extract(c.retirement_json,'$.specHash')=e.spec_hash " +
      "AND json_extract(c.retirement_json,'$.candidateIntentHash')=e.candidate_intent_hash " +
      "AND json_extract(c.retirement_json,'$.retiredAtMs')=c.retired_ms AND (" +
      "(json_extract(c.retirement_json,'$.kind')='original-candidate-scope-retired-v1' AND c.child_id IS NOT NULL " +
      "AND json_extract(c.retirement_json,'$.containerId')=c.child_id " +
      "AND json_extract(c.retirement_json,'$.childBirthHash')=c.child_birth_hash " +
      "AND json_extract(c.retirement_json,'$.childStartHash') IS c.child_start_hash " +
      "AND json_extract(c.retirement_json,'$.daemonId')=e.daemon_id " +
      "AND json_type(c.retirement_json,'$.exitCode')='integer' " +
      "AND json_extract(c.retirement_json,'$.exitCode') BETWEEN 0 AND 255 " +
      "AND length(json_extract(c.retirement_json,'$.waitJoinSha256'))=64 " +
      "AND json_extract(c.retirement_json,'$.waitJoinSha256') NOT GLOB '*[^0-9a-f]*' " +
      "AND length(json_extract(c.retirement_json,'$.eofSha256'))=64 " +
      "AND json_extract(c.retirement_json,'$.eofSha256') NOT GLOB '*[^0-9a-f]*') OR (" +
      "json_extract(c.retirement_json,'$.kind')='original-candidate-no-create-v1' AND c.child_id IS NULL " +
      "AND c.material_release_id IS NULL AND c.unknown_ms IS NULL " +
      "AND json_extract(c.retirement_json,'$.createEffectHash') IS c.create_effect_hash " +
      "AND length(json_extract(c.retirement_json,'$.originalNotSentSha256'))=64 " +
      "AND json_extract(c.retirement_json,'$.originalNotSentSha256') NOT GLOB '*[^0-9a-f]*'))) ELSE 1 END IS NOT 0 " +
      "OR (r.status='success' AND CASE WHEN json_valid(c.result_json)=1 AND json_valid(c.retirement_json)=1 THEN NOT (" +
      "json_extract(c.result_json,'$.verification')='response-verified' AND json_extract(c.result_json,'$.exitCode')=0 " +
      "AND json_extract(c.retirement_json,'$.exitCode')=0) ELSE 1 END IS NOT 0)) LIMIT 1"
    ).get();
    if(candidate!==undefined)return true;
  }
  const invalid = db.prepare(
    "SELECT 1 FROM job_run_managed_execution e LEFT JOIN job_runs r ON r.id=e.run_id " +
    "WHERE " + (candidateProtocol ? "e.candidate_waiting_protocol IS NOT 'original-candidate-waiting-v1' AND (" : "") +
    "e.phase!='retired' OR r.id IS NULL OR r.status NOT IN ('success','failed','cancelled','timeout') " +
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
    " ELSE 1 END IS NOT 0" + (candidateProtocol ? ")" : "") + " LIMIT 1"
  ).get();
  return invalid !== undefined;
}
