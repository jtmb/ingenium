import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import {fixture,seedScope}from'../../../docs/workstreams/projects/projectless-context-136/context-fixture.mjs';
import {createApiMemorySession}from'../lib/memory-v2/adapters.mjs';
import {authorizeMemoryRequestOperation}from'../lib/memory-v2/request-policy.mjs';
// Real SQLite and actual adapter/lifecycle; identity/execution ports are explicit
// unit fixtures, not a physical original runtime or authenticated HTTP proof.
function setup(work){const db=fixture();try{
 const canonical=seedScope(db);db.exec(readFileSync(new URL('../../../packages/ingenium-core/data/migrations/123_veyra_memory_lifecycle.sql',import.meta.url),'utf8'));
 const execution={...canonical,available:true,status:'authorized',mode:'runtime',hostId:'host',environmentId:'environment'};
 const principal={type:'user',id:'owner',scopes:['user:*']};let actor={principal},method='GET',legacyCalls=0,checkpoints=0;
 const session=createApiMemorySession({core:{getDb:()=>db,execTransaction:fn=>db.transaction(fn).immediate(),checkpointAfterWrite:()=>{checkpoints++}},request:{},selected:{projectId:null,workspaceId:canonical.workspaceId,runtimeId:canonical.runtimeId},authenticate:()=>actor,resolveExistingScope:()=>{legacyCalls++;throw Error('No global Project substitute')},resolveProjectlessScope:()=>({...execution,projectId:null,visibility:'private'}),resolveExecution:()=>execution,resolveChatBinding:()=>{throw Error('No chat authority supplied by this policy fixture')},authorizeOperation:({principal:expectedPrincipal,permission,scope})=>authorizeMemoryRequestOperation({permission,expectedPrincipal,identity:actor,method,csrf:()=>method!=='GET',decide:()=>scope.ownerUserId===actor.principal.id}),resolveSourceState:()=>{throw Error('Unqualified projectless sources must remain unavailable')}});
 work({db,session,execution,setMethod:value=>{method=value},setActor:value=>{actor=value},counts:()=>({legacyCalls,checkpoints})});assert.deepEqual(db.pragma('foreign_key_check'),[]);
}finally{db.close();}}
test('actual null-Project runtime passes the existing adapter without a fake Project or legacy scope owner',()=>setup(({db,session,counts})=>{
 const before=db.prepare('SELECT count(*) AS n FROM projects').get().n,scope=session.resolveScope('read');assert.equal(scope.projectId,null);assert.equal(scope.ownerUserId,'owner');assert.equal(session.memory.scopePolicy(scope).policy.enabled,true);assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n,before);assert.equal(counts().legacyCalls,0);
}));
test('scope policy persists in the same SQLite tables with a distinct actual null Project key',()=>setup(({db,session,setMethod,counts})=>{
 setMethod('PUT');const scope=session.resolveScope('write-policy');const result=session.memory.setPolicy(scope,{operationId:'null-policy',expectedRevision:0,enabled:true,generate:false,useMemory:false,externalContext:false});assert.equal(result.receipt.revision,1);setMethod('GET');assert.equal(session.memory.scopePolicy(scope).policy.useMemory,false);const rows=db.prepare('SELECT scope_key FROM veyra_memory_policy').all();assert.equal(rows.length,1);assert.equal(JSON.parse(rows[0].scope_key)[4],null);assert.deepEqual(counts(),{legacyCalls:0,checkpoints:1});
}));
test('reset preview stays read-only; reset and operation receipt remain durable for the null scope',()=>setup(({db,session,setMethod,counts})=>{
 const scope=session.resolveScope('preview-forget'),preview=session.memory.previewReset(scope);assert.equal(preview.count,0);assert.equal(counts().checkpoints,0);assert.throws(()=>session.memory.reset(scope,{operationId:'blocked-get',confirmation:preview.confirmation}),{code:'FORBIDDEN'});setMethod('POST');const result=session.memory.reset(scope,{operationId:'null-reset',confirmation:preview.confirmation});assert.equal(result.receipt.status,'committed');setMethod('GET');assert.equal(session.memory.operation(scope,'null-reset').status,'committed');assert.equal(db.prepare('SELECT count(*) AS n FROM veyra_memory_receipt').get().n,1);
}));
test('another actor or mismatched execution cannot adopt the owned null scope',()=>setup(({session,setActor,execution})=>{
 setActor({principal:{type:'user',id:'other',scopes:['user:*']}});assert.throws(()=>session.resolveScope('read'),{code:'FORBIDDEN'});setActor({principal:{type:'user',id:'owner',scopes:['user:*']}});execution.projectId='project';assert.throws(()=>session.resolveScope('read'),{code:'FORBIDDEN'});
}));
test('service capability cannot inherit projectless browser ownership',()=>setup(({session,setActor,execution})=>{
 setActor({principal:{type:'service',id:'service',tokenId:'credential',workspaceId:execution.workspaceId,storageMappingHash:execution.bindingHash,scopes:['memory:read']},attestation:{credentialId:'credential',workspaceId:execution.workspaceId,storageMappingHash:execution.bindingHash}});assert.throws(()=>session.resolveScope('read'),{code:'MEMORY_ADAPTER_UNAVAILABLE'});
}));
