import { logger, runtimes } from "ingenium-core";
import { inspectManagedRuntime, removeManagedRuntime, stopManagedRuntime } from "./runtime-manager-client.js";

let timer: ReturnType<typeof setInterval> | null = null;

function intervalMs(): number {
  const raw = process.env.INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS?.trim() ?? "15000";
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error("INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS is invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000) throw new Error("INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS is invalid");
  return value;
}

async function stopExpired(runtime: runtimes.RuntimeInstance): Promise<void> {
  let current = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STOPPING", actorType: "system", actorId: "runtime-reconciler" });
  await stopManagedRuntime(current.id);
  current = runtimes.transitionRuntime({ id: current.id, expectedRevision: current.revision, toState: "STOPPED", actorType: "system", actorId: "runtime-reconciler" });
  void current;
}

export async function reconcileRuntimes(now = new Date()): Promise<void> {
  runtimes.markExpiredRuntimeOrphans(now);
  for (const original of runtimes.listRuntimeInstances()) {
    if (original.state === "ABSENT" || original.state === "STOPPED" || original.state === "REVOKED" || original.state === "PROVISIONING") continue;
    try {
      const backend = await inspectManagedRuntime(original.id);
      if (original.state === "FAILED") {
        if (backend.state !== "absent") await removeManagedRuntime(original.id);
        continue;
      }
      let runtime = runtimes.getRuntimeInstance(original.id);
      if (!runtime || runtime.revision !== original.revision) continue;
      if (backend.state !== "running" || (runtime.backendContainerId && backend.backendId !== runtime.backendContainerId)) {
        if (runtime.state !== "STOPPING") runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "FAILED", actorType: "system", actorId: "runtime-reconciler" });
        continue;
      }
      if (backend.backendId && runtime.backendContainerId === backend.backendId) {
        runtime = runtimes.recordRuntimeHealth(runtime.id, runtime.revision, backend.backendId, now);
      }
      if (runtime.state === "STARTING" && backend.state === "running" && backend.health === "healthy") {
        runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "runtime-reconciler" });
        continue;
      }
      const absoluteExpired = runtime.absoluteExpiresAt !== null && runtime.absoluteExpiresAt <= now.toISOString();
      const idleExpired = runtime.idleExpiresAt !== null && runtime.idleExpiresAt <= now.toISOString()
        && runtime.activeConnections === 0 && runtime.activeGenerations === 0;
      if ((absoluteExpired || idleExpired) && (runtime.state === "READY" || runtime.state === "IDLE")) {
        await stopExpired(runtime);
      } else if (runtime.state === "READY" && runtime.activeConnections === 0 && runtime.activeGenerations === 0) {
        runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "IDLE", actorType: "system", actorId: "runtime-reconciler" });
      } else if (runtime.state === "IDLE" && (runtime.activeConnections > 0 || runtime.activeGenerations > 0)) {
        runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "runtime-reconciler" });
      }
    } catch {
      logger.warn("runtime-reconciler", "Runtime reconciliation deferred", { runtimeId: original.id });
    }
  }
}

export function startRuntimeReconciler(): () => void {
  if (timer) return stopRuntimeReconciler;
  timer = setInterval(() => { void reconcileRuntimes(); }, intervalMs());
  timer.unref?.();
  return stopRuntimeReconciler;
}

export function stopRuntimeReconciler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
