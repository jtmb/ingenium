import type { Actor, DotScope } from "../../../../packages/veyra-automation/contracts.js";
import type { BoundJob, JobAuthority } from "./service.js";
import { DotError } from "./service.js";

export interface ExistingJobPorts {
  resolveAuthorizedBinding(actor: Actor, scope: DotScope, jobId: string): BoundJob;
  startJobRun(projectId: string, jobId: string, trigger: "cron", provenance: { scheduledFor: string; expectedScheduleRevision: number }): { id: string } | { reason: string };
  cancelOwnedRun(scope: DotScope, runId: string): void;
  inspectOwnedRun(scope: DotScope, runId: string): ReturnType<JobAuthority["inspect"]>;
}
/** No timer, database opener, process launcher, automatic replay or permission override. */
export function existingJobsAuthority(ports: ExistingJobPorts): JobAuthority {
  return {
    readAuthorizedJob: (actor,scope,id) => {
      if(scope.projectId === null) throw new DotError("DOT_PROJECTLESS_UNBOUND");
      return ports.resolveAuthorizedBinding(actor,scope,id);
    },
    claim(job,scheduledFor,toolPolicy) {
      if (!job.scope.projectId) throw new DotError("DOT_PROJECTLESS_UNBOUND");
      if (toolPolicy !== "existing-grants-only") throw new DotError("DOT_FORBIDDEN");
      const result = ports.startJobRun(job.scope.projectId,job.id,"cron",{scheduledFor,expectedScheduleRevision:job.scheduleRevision});
      if ("id" in result) return {runId:result.id};
      const retryable=["Job already has a running or queued run","Automation concurrency quota is full"].includes(result.reason);
      return {blocked:result.reason,retryable};
    },
    requestCancellation: (scope,id) => ports.cancelOwnedRun(scope,id),
    inspect: (scope,id) => ports.inspectOwnedRun(scope,id),
  };
}
