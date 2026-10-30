/** Only unresolved entries participate in signalling, recovery and pending tests. */
function pendingDetachedRun(runId: string): OwnedDetachedRun | undefined {
  const tracked = ownedDetachedRuns.get(runId);
  return tracked?.retiredAt === undefined ? tracked : undefined;
}

const MAX_OWNED_RUN_RETIREMENT_RECEIPTS = 256;

/** Called only by the existing complete, identity-bound empty-group verifier. */
function retireOwnedGroup(tracked: OwnedDetachedRun): void {
  if (ownedDetachedRuns.get(tracked.runId) !== tracked || !tracked.leader || tracked.retiredAt !== undefined) return;
  recordTrackingEvent(tracked, "teardown-verified", "owned-group-empty");
  clearGroupRecoveryTimer(tracked.runId);
  tracked.retiredAt = Date.now();
  // Keep the captured leader/nonce identity and project/run/job binding only.
  tracked.initialGroupMembers = [];
  tracked.lastObservedGroupMembers = [];
  tracked.knownMembers.clear();
  tracked.events = [];
  // Reinsert at retirement time; remove only old positive receipts, never pending ownership.
  ownedDetachedRuns.delete(tracked.runId);
  ownedDetachedRuns.set(tracked.runId, tracked);
  let retired = 0;
  for (const entry of ownedDetachedRuns.values()) if (entry.retiredAt !== undefined) retired++;
  for (const [id, entry] of ownedDetachedRuns) {
    if (retired <= MAX_OWNED_RUN_RETIREMENT_RECEIPTS) break;
    if (entry.retiredAt === undefined || ownedRunLifecyclePending(id)) continue;
    ownedDetachedRuns.delete(id);
    retired--;
  }
  finalizeVaultRunAfterVerifiedTeardown(tracked.runId);
}

function ownedRunLifecyclePending(runId: string): boolean {
  return forceKillTimers.has(runId) || terminationCompletions.has(runId)
    || resolveEscalations.has(runId) || teardownAttempts.has(runId)
    || runningProcesses.has(runId) || closePromises.has(runId) || groupRecoveryTimers.has(runId);
}

export type OwnedJobRunInspection = Readonly<{
  state: "active" | "settled" | "unknown";
  reason: "owned-group-active" | "owned-group-retired" | "ownership-unavailable" | "lifecycle-pending" | "group-unverified";
}>;

/** Process settlement evidence only; callers must independently authorize the request. */
export function inspectOwnedJobRun(projectId: string, runId: string): OwnedJobRunInspection {
  const unknown = (reason: OwnedJobRunInspection["reason"] = "ownership-unavailable"): OwnedJobRunInspection => ({ state: "unknown", reason });
  if (!supportsOwnedProcessGroups) return unknown();
  const tracked = ownedDetachedRuns.get(runId);
  if (!tracked || tracked.projectId !== projectId || tracked.runId !== runId || !tracked.leader) return unknown();
  let run: ReturnType<typeof jobs.getJobRun>;
  try { run = jobs.getJobRun(projectId, runId); } catch { return unknown(); }
  if (!run || run.id !== runId || run.project_id !== projectId || run.job_id !== tracked.jobId) return unknown();
  if (runProjects.has(runId) && runProjects.get(runId) !== projectId) return unknown();
  if (forceKillTimers.has(runId) || terminationCompletions.has(runId) || resolveEscalations.has(runId) || teardownAttempts.has(runId)) return unknown("lifecycle-pending");
  if (tracked.retiredAt !== undefined) {
    // Absence of these handles is a gate, never the source of positive proof.
    if (ownedRunLifecyclePending(runId)) return unknown("lifecycle-pending");
    return { state: "settled", reason: "owned-group-retired" };
  }
  const verification = revalidateOwnedGroup(tracked);
  if (verification.status === "trusted") return { state: "active", reason: "owned-group-active" };
  // Read-side observation never retires a group, cleans files or initiates teardown.
  return unknown("group-unverified");
}
