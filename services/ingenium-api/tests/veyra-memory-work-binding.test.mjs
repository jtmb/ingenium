import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {MemoryLifecycle,scopeKey} from '../lib/memory-v2/lifecycle.mjs';
import {memoryResponse} from '../lib/memory-v2/http.mjs';
import {authorizeMemoryRequestOperation} from '../lib/memory-v2/request-policy.mjs';
import {RequestExecutionError} from '../lib/projects-v2/request-execution-owner.mjs';
import {mapRequestExecutionFailure} from '../lib/memory-v2/request-policy.mjs';
import {expectedMemoryBinding,assertExpectedMemoryBinding} from '../lib/memory-v2/expected-binding.mjs';
const scope={organizationId:'org',ownerUserId:'owner',projectId:'project',workspaceId:'workspace',hostId:'host',environmentId:'environment',visibility:'private',bindingHash:'b'.repeat(64),bindingEpoch:3};
const hash=createHash('sha256').update(scopeKey(scope)).digest('hex');
const headers={'X-Veyra-Memory-Scope':hash,'X-Veyra-Memory-Binding':scope.bindingHash,'X-Veyra-Memory-Epoch':'3','X-Veyra-Memory-Context':'context-original'};
const parsed=()=>expectedMemoryBinding(name=>headers[name]);
test('hosted guards preserve legacy absence and reject incomplete, duplicate and noncanonical headers',()=>{
 assert.equal(expectedMemoryBinding(()=>undefined),null);
 for(const changed of [{...headers,'X-Veyra-Memory-Scope':undefined},{...headers,'X-Veyra-Memory-Epoch':'03'},
  {...headers,'X-Veyra-Memory-Epoch':'9007199254740992'},{...headers,'X-Veyra-Memory-Context':'original, other'},
  {...headers,'X-Veyra-Memory-Binding':headers['X-Veyra-Memory-Binding']+', '+headers['X-Veyra-Memory-Binding']}])
   assert.throws(()=>expectedMemoryBinding(name=>changed[name]),{code:'INVALID_INPUT'});
});
test('same durable scope cannot reuse a different execution epoch, host or canonical conversation',()=>{
 const expected=parsed();assert.doesNotThrow(()=>assertExpectedMemoryBinding(expected,scope,'context-original'));
 for(const changed of [{...scope,bindingEpoch:4},{...scope,bindingHash:'c'.repeat(64)},{...scope,hostId:'other'},
  {...scope,workspaceId:'other'},{...scope,ownerUserId:'other'}])assert.throws(()=>assertExpectedMemoryBinding(expected,changed,'context-original'),{code:'BINDING_CHANGED'});
 assert.throws(()=>assertExpectedMemoryBinding(expected,scope,'context-other'),{code:'BINDING_CHANGED'});
});
test('reset preview requires fresh write authorization but does not turn GET into a mutation grant',()=>{
 const principal={type:'user',id:'owner',scopes:['memory:write'],session:{id:'session',security_epoch:1}};
 const base={expectedPrincipal:principal,identity:{principal},method:'GET',csrf:()=>{throw Error('GET must not call CSRF');},decide:(_p,level)=>level==='write'};
 assert.equal(authorizeMemoryRequestOperation({...base,permission:'preview-forget'}),true);
 assert.equal(authorizeMemoryRequestOperation({...base,permission:'forget'}),false);
 assert.equal(authorizeMemoryRequestOperation({...base,permission:'write-policy'}),false);
 assert.equal(authorizeMemoryRequestOperation({...base,permission:'preview-forget',decide:()=>false}),false);
 assert.equal(authorizeMemoryRequestOperation({...base,permission:'preview-forget',identity:null}),false);
 assert.equal(authorizeMemoryRequestOperation({...base,permission:'preview-forget',method:'HEAD'}),false);
 assert.equal(authorizeMemoryRequestOperation({...base,permission:'preview-forget',method:'POST',csrf:()=>false}),false);
});
test('real reset preview reads SQLite without writes; actual reset retains unsafe authorization and receipt',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../lib/memory-v2/schema.sql',import.meta.url),'utf8'));
 const principal={type:'user',id:'owner',scopes:['memory:write']};let method='GET',checkpoints=0;
 const authorize=(_s,permission)=>authorizeMemoryRequestOperation({permission,expectedPrincipal:principal,identity:{principal},method,csrf:()=>method==='POST',decide:(_p,level)=>level==='write'});
 const memory=new MemoryLifecycle({db,authorize,sources:()=>null,checkpoint:()=>{checkpoints++;}});
 try{
  const before=JSON.stringify(db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all());
  const preview=memoryResponse(memory,(_r,permission)=>{assert.equal(authorize(scope,permission),true);return scope;},{action:'reset-preview',method:'GET'});
  assert.equal(preview.status,200);assert.equal(preview.body.data.count,0);assert.equal(checkpoints,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM veyra_memory_receipt').get().n,0);
  assert.equal(JSON.stringify(db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all()),before);
  assert.throws(()=>memory.reset(scope,{operationId:'blocked-get',confirmation:preview.body.data.confirmation}),{code:'FORBIDDEN'});
  method='POST';const reset=memory.reset(scope,{operationId:'original-reset',confirmation:preview.body.data.confirmation});
  assert.equal(reset.receipt.status,'committed');assert.equal(reset.receipt.operation,'reset');assert.equal(checkpoints,1);
 }finally{db.close();}
});

test('real v2 execution failures retain unavailable/forbidden/input responses without a private-owner fallback',()=>{
 for(const code of ['WORKSPACE_V2_RUNTIME_NOT_READY','WORKSPACE_V2_ORIGINAL_PLACEMENT_UNAVAILABLE','WORKSPACE_V2_ORIGINAL_PLACEMENT_CONTEXT_REQUIRED','WORKSPACE_V2_BINDING_CHANGED'])assert.equal(mapRequestExecutionFailure(new RequestExecutionError(code,503),RequestExecutionError).code,'MEMORY_ADAPTER_UNAVAILABLE');
 for(const code of ['WORKSPACE_V2_USER_IDENTITY','WORKSPACE_V2_EXECUTION_SCOPE'])assert.equal(mapRequestExecutionFailure(new RequestExecutionError(code,503),RequestExecutionError).code,'FORBIDDEN');
 assert.equal(mapRequestExecutionFailure(new RequestExecutionError('WORKSPACE_V2_EXECUTION_SELECTION',503),RequestExecutionError).code,'INVALID_INPUT');
 assert.throws(()=>mapRequestExecutionFailure(new RequestExecutionError('UNREVIEWED_PRIVATE_FAILURE',503),RequestExecutionError),/UNREVIEWED_PRIVATE_FAILURE/);
});
