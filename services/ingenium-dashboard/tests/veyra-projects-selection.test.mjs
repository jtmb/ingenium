import test from "node:test";
import assert from "node:assert/strict";
import {selectProject, executionChoices, selectionStatus} from "../src/app/components/projects-v2/selection.mjs";
const projects=[{id:"p-a",archivedAt:null},{id:"archived",archivedAt:"2026-10-29"}];
const choices=[
  {projectId:"p-a",binding:{id:"local"},available:false,reason:"Host offline"},
  {projectId:"p-a",binding:{id:"cluster"},available:true},
  {projectId:null,binding:{id:"private"},available:true},
];
test("project switching resets binding and explicit projectless remains private",()=>{
  assert.deepEqual(selectProject({projectId:"p-a",bindingId:"cluster"},null),{projectId:null,bindingId:null});
  assert.deepEqual(executionChoices(choices,null).map(c=>c.binding.id),["private"]);
  assert.equal(selectionStatus({projects,choices,selection:{projectId:null,bindingId:"cluster"}}).ready,false);
});
test("unavailable project/host never silently falls back to another available target",()=>{
  assert.equal(selectionStatus({projects,choices,selection:{projectId:"missing",bindingId:"cluster"}}).ready,false);
  assert.equal(selectionStatus({projects,choices,selection:{projectId:"archived",bindingId:"cluster"}}).ready,false);
  const offline=selectionStatus({projects,choices,selection:{projectId:"p-a",bindingId:"local"}});
  assert.equal(offline.ready,false);assert.equal(offline.reason,"Host offline");
  assert.equal(selectionStatus({projects,choices,selection:{projectId:"p-a",bindingId:"cluster"}}).ready,true);
});
