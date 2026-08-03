/** Fixed, non-user-controlled supervisor bridge for RESTORE-101 maintenance. */
const SUPERVISOR_RPC = "http://127.0.0.1:9001/RPC2";
const RESTORE_MAINTENANCE_PROGRAM = "restore-maintenance";

export async function startRestoreMaintenance(): Promise<void> {
  const response = await fetch(SUPERVISOR_RPC, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: `<?xml version="1.0"?><methodCall><methodName>supervisor.startProcess</methodName><params><param><value><string>${RESTORE_MAINTENANCE_PROGRAM}</string></value></param><param><value><boolean>0</boolean></value></param></params></methodCall>`,
    signal: AbortSignal.timeout(5_000),
  });
  const xml = await response.text();
  // Supervisor reports an already-running one-shot program as a fault. That is
  // still a successful idempotent handoff: the static privileged executor owns
  // the queued work and will claim it exactly once.
  if (!response.ok || (xml.includes("<fault>") && !xml.includes("ALREADY_STARTED"))) {
    throw new Error("RESTORE_SUPERVISOR_START_FAILED");
  }
}

export { RESTORE_MAINTENANCE_PROGRAM };
