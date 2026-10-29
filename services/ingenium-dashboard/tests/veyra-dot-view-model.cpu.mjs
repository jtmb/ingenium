import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalSchedule, scheduleLabel, operationLabel } from "../src/app/components/dot-v2/view-model.ts";
test("approval preserves explicit timezone/fold and UTC once semantics",()=>{
 const value=approvalSchedule({kind:"calendar",at:"",timeZone:"America/Toronto",hour:"9",minute:"30",fold:"later"});
 assert.equal(value.timeZone,"America/Toronto");assert.equal(value.fold,"later");assert.match(scheduleLabel(value),/09:30/);
 assert.deepEqual(approvalSchedule({kind:"once",at:"2026-11-01T14:00:00Z"}),{kind:"once",at:"2026-11-01T14:00:00.000Z"});
});
test("invalid schedule inputs cannot become implicit local times",()=>{
 assert.throws(()=>approvalSchedule({kind:"once",at:"2026-11-01T14:00:00"}));
 assert.throws(()=>approvalSchedule({kind:"calendar",timeZone:"",hour:"9",minute:"0",fold:"earlier"}));
 assert.throws(()=>approvalSchedule({kind:"calendar",timeZone:"UTC",hour:"",minute:"0",fold:"earlier"}));
 assert.throws(()=>approvalSchedule({kind:"calendar",timeZone:"UTC",hour:"25",minute:"0",fold:"earlier"}));
});
test("pending cancellation and unknown outcomes never display completion",()=>{
 assert.match(operationLabel("cancel_requested"),/requested/);assert.match(operationLabel("unknown"),/inspect before retrying/);
 assert.equal(operationLabel("alien"),"Status unavailable");
});
