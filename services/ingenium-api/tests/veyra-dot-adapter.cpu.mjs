import { test } from "node:test";
import assert from "node:assert/strict";
import { existingJobsAuthority } from "../lib/dot-v2/existing-jobs.ts";
import { dotErrorResponse, executeDotCommand } from "../lib/dot-v2/commands.ts";
test("bridge reuses exact existing cron claim and never creates a runner/scheduler",()=>{
 const calls=[];const port=existingJobsAuthority({resolveAuthorizedBinding(){},startJobRun(...args){calls.push(args);return {id:"run"};},cancelOwnedRun(...args){calls.push(args);},inspectOwnedRun(){return "unknown";}});
 assert.deepEqual(port.claim({id:"job",scope:{projectId:"p"},scheduleRevision:4},"2026-11-01T14:00:00.000Z","existing-grants-only"),{runId:"run"});
 assert.deepEqual(calls[0],["p","job","cron",{scheduledFor:"2026-11-01T14:00:00.000Z",expectedScheduleRevision:4}]);
 assert.throws(()=>port.claim({scope:{projectId:null}},"now","existing-grants-only"),/PROJECTLESS_UNBOUND/);
 assert.throws(()=>port.claim({scope:{projectId:"p"}},"now","full-access"),/FORBIDDEN/);
 assert.equal(port.inspect({},"run"),"unknown");
});
test("command validation and errors preserve revision requirements and hide internal failures",()=>{
 assert.throws(()=>executeDotCommand({}, {}, {}, {type:"cancel",id:"a",revision:-1}),/VALIDATION/);
 assert.throws(()=>executeDotCommand({}, {}, {}, {type:"surprise",id:"a",revision:0}),/VALIDATION/);
 const error=dotErrorResponse(Error("secret SQL /private/path"));assert.equal(error.status,500);assert.doesNotMatch(JSON.stringify(error),/private|secret SQL/);
 assert.equal(dotErrorResponse(new RangeError("bad time")).status,422);
});
