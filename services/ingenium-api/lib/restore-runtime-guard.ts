import type { runtimes } from "ingenium-core";

export function hasActiveRuntimeForRestore(instances: readonly Pick<runtimes.RuntimeInstance, "state">[]): boolean {
  return instances.some((runtime) =>
    runtime.state !== "ABSENT" && runtime.state !== "STOPPED" && runtime.state !== "FAILED" && runtime.state !== "REVOKED");
}
