import {getDb} from "ingenium-core";
import type {CoreDotRuntime} from "./core-binding.js";
import {installedDotApprovedScopeReader} from "./installed-dot-approved-scope.js";
import {DotError} from "./service.js";
/** Existing scheduler consumes only this interface. No timer, task queue, database
 * opener, credential owner or request closure is created by this interlock. */
export type DotSchedulerRuntime=Pick<CoreDotRuntime,"usesAsyncExecution"|"ownsJob"|"dispatchJob"|"recoverOperations"|"recoverOperationsAsync">;
const unavailable=():never=>{throw new DotError("DOT_AUTONOMOUS_CORE_DELEGATION_UNAVAILABLE");};
/** Concrete unavailable-state interlock, not a working autonomous execution owner.
 * Original approved scope/policy facts are reconstructed; the private Core prepare/read
 * delegation and private Memory source authorization constructors remain missing.
 * Durable Dot-bound jobs must never fall through to the ordinary cron runner. */
export const installedDotSchedulerInterlock:DotSchedulerRuntime={
 usesAsyncExecution:true,
 ownsJob(projectId,jobId){return !!getDb().prepare("SELECT 1 FROM veyra_dot_records WHERE kind='followup' AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.jobId')=? AND json_extract(body,'$.state')!='cancelled' LIMIT 1").get(projectId,jobId);},
 async dispatchJob(projectId,jobId,isActive){if(!isActive())return;await installedDotApprovedScopeReader.resolve(projectId,jobId);if(!isActive())return;unavailable();},
 recoverOperations(){return unavailable();},
 async recoverOperationsAsync(){return unavailable();},
};
