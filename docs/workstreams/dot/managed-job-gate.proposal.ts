/** The current managed-runtime owner has no per-JobRun launch/settlement protocol.
 * Placement and healthy engine observations cannot supply this capability.
 * Replace this gate only together with the canonical owner protocol and its proof.
 */
export function managedRuntimeJobExecutionCapability(runtimeId: string): Readonly<{
  schemaVersion: 1; runtimeId: string; available: false;
  code: "MANAGED_JOB_OWNER_PROTOCOL_UNAVAILABLE";
}> {
  if (typeof runtimeId !== "string" || !UUID.test(runtimeId)) throw new Error("Managed JobRun runtime identity is invalid");
  return Object.freeze({ schemaVersion: 1, runtimeId, available: false, code: "MANAGED_JOB_OWNER_PROTOCOL_UNAVAILABLE" });
}

/** Never fall back to the control-plane runner for a selected managed runtime. */
export function requireManagedRuntimeJobExecution(runtimeId: string): never {
  const capability = managedRuntimeJobExecutionCapability(runtimeId);
  throw Object.assign(new Error("Managed runtime JobRun ownership protocol is unavailable"), {
    code: capability.code, status: 503,
  });
}
