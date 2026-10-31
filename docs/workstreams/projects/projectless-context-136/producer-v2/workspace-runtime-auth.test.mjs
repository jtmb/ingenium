// AUTHORED UNRUN. Pure protocol binding tests, not cryptographic/producer acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveWorkspaceRuntimeOpenCodePasswordV2 as derive} from './workspace-runtime-auth.mjs';
const secret=Buffer.alloc(32,7);secret.writeBigUInt64BE(3n);const token='ing_abcdefghijkl_'+secret.toString('base64url');
const scope={projectId:null,organizationId:'org',ownerUserId:'owner',workspaceId:'workspace',runtimeId:'runtime',credentialId:'credential',bindingHash:'a'.repeat(64),bindingEpoch:4,executionGeneration:'b'.repeat(64),requestId:'original-request'};
test('same original custody and birth have stable43-character output without exposing the credential',()=>{const a=derive(token,scope);assert.equal(a,derive(token,{...scope}));assert.match(a,/^[A-Za-z0-9_-]{43}$/);assert.equal(a.includes(token),false);});
for(const key of ['organizationId','ownerUserId','workspaceId','runtimeId','credentialId','bindingHash','bindingEpoch','executionGeneration','requestId'])test('changed '+key+' cannot reuse original OpenCode auth',()=>{
 const value=key==='bindingEpoch'?5:key==='bindingHash'||key==='executionGeneration'?'c'.repeat(64):'different';assert.notEqual(derive(token,{...scope,[key]:value}),derive(token,scope));
});
test('different v2 credential/user epoch changes auth and Project/sentinel scope refuses',()=>{
 const next=Buffer.from(secret);next.writeBigUInt64BE(4n);assert.notEqual(derive('ing_abcdefghijkl_'+next.toString('base64url'),scope),derive(token,scope));
 for(const projectId of ['global-default','null','',undefined])assert.throws(()=>derive(token,{...scope,projectId}));
 assert.throws(()=>derive('browser-dto',{...scope}));assert.throws(()=>derive(token,{...scope,executionGeneration:'not-an-original-start'}));
});
