import test from "node:test";
import assert from "node:assert/strict";
import {WorkspaceReads} from "../lib/projects-v2/reads.mjs";
const scope={instanceId:"instance",organizationId:"org",ownerUserId:"alice"};
const binding={version:1,id:"binding",hostId:"host",environmentId:"env",workspaceBindingId:"mapped",
  canonicalRootId:"file-id",directory:"C:/work",shellId:"pwsh",securityEpoch:1,kind:"windows",
  workspaceIdentity:"inode",mappingHash:"a".repeat(64),ownerInstanceId:"service",ownerRevision:3};
test("terminal owner reads remain scoped, bounded and reconnectable without another PTY",async()=>{
  let reads=0;
  const admission={scope,binding,projectId:null,online:true,capabilities:["terminal:read"],terminalId:"term"};
  const reader=new WorkspaceReads({catalog:{},resolveAdmission:async()=>admission,
    readOwner:async()=>{reads++;return {state:"running",chunks:[{sequence:7,data:"before"},{sequence:8,data:"after"}]};}});
  const result=await reader.read(scope,{projectId:null,binding,kind:"output",
    args:{terminalId:"term",afterSequence:6,maxBytes:6}});
  assert.equal(result.chunks.length,1);assert.equal(result.nextSequence,7);assert.equal(result.truncated,true);
  await assert.rejects(()=>reader.read(scope,{projectId:null,binding,kind:"output",
    args:{terminalId:"someone-else"}}),e=>e.code==="TERMINAL_SCOPE_MISMATCH");
  admission.online=false;
  await assert.rejects(()=>reader.read(scope,{projectId:null,binding,kind:"terminals"}),e=>e.code==="HOST_UNAVAILABLE");
  assert.equal(reads,1);
});
