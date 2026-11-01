// Canonical client under explicit VM transport/Core fixtures. Positive execution,
// image approval, physical source/retirement and genuine Core prepare are NOT
// qualified here; these controls exercise the private terminal-event state path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {EventEmitter} from 'node:events';
import * as crypto from 'node:crypto';
const root=fileURLToPath(new URL('../../..',import.meta.url)).replace(/\/$/,''),run='00000000-0000-4000-8000-000000000001',token='m'.repeat(43);
const {hash}=await import(pathToFileURL(root+'/packages/veyra-operations/core126-image-contract.mjs'));
const {parseStrictJobJson}=await import(pathToFileURL(root+'/services/ingenium-api/lib/dot-v2/job-bootstrap-frame.mjs'));
async function fixture(options={}){
 let api,inTransaction=false,retains=0,contexts=0,finalControls=0,executeReads=0,network=0,handle,facts;
 const events=[],binding={runId:run,attemptId:'00000000-0000-4000-8000-000000000002',candidateIntentHash:'a'.repeat(64),specHash:'b'.repeat(64),selectionSha256:'c'.repeat(64),deadlineAt:new Date(Date.now()+60000).toISOString(),deadlineMs:Date.now()+60000};
 const snapshot={binding,revision:7,phase:'waiting'},originalContext=Object.freeze({}),control=Object.freeze({}),preparation=Object.freeze({});
 const owner={
  candidateOriginalRpcPreparation(id,context){assert.equal(id,run);assert.equal(context,originalContext);return preparation;},
  requireOriginalCandidateRpcPreparation(key,context){assert.equal(key,preparation);assert.equal(context,originalContext);return snapshot;},
  requireOriginalCandidateRpcControlPreparation(key,context){assert.equal(key,preparation);assert.equal(context,control);events.push('control-snapshot');return {...snapshot,phase:options.alreadyUnknown?'unknown':snapshot.phase};},
  requireOriginalCandidateRpcFinalControlWrite(key,context){finalControls++;assert.equal(inTransaction,true);assert.equal(key,preparation);assert.equal(context,control);events.push('final-control');return {...snapshot,binding:options.bindingChanged?{...binding,attemptId:'replacement'}:binding};},
  requireOriginalCandidateRpcFinalWrite(){executeReads++;throw Error('Execute approval must not be requested for terminal uncertainty');},
  candidateRetainUnknown(id,context,original){retains++;events.push('begin-final-transaction');assert.equal(id,run);assert.equal(context,control);handle=original;inTransaction=true;try{if(options.writeFailure)throw Error('Fixture Core CAS failure');facts=api.spendOriginalCandidateRpcUnknown(original,binding,context);events.push('negative-cas');}finally{inTransaction=false;events.push('end-final-transaction');}}
 };
 const context=createContext({Buffer,Uint8Array,URL,AbortSignal,setTimeout,clearTimeout,process:{env:{INGENIUM_RUNTIME_MANAGER_URL:'http://original-manager:3010/',INGENIUM_RUNTIME_MANAGER_TOKEN_FILE:'/fixture/token'},getuid:()=>1000},fetch(){throw Error('No generic transport');}});
 const synthetic=async(name,exports)=>{const m=new SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context,identifier:name});await m.link(()=>{});await m.evaluate();return m;};
 const modules={
  'node:crypto':await synthetic('crypto',crypto),
  'node:fs':await synthetic('fs',{lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,uid:1000,mode:0o100600}),realpathSync:p=>p,readFileSync:()=>token}),
  'ingenium-core/lib/tools/runtime-original-provision':await synthetic('provision',{}),
  './runtime-placement-contract.js':await synthetic('placement',{isManagedRuntimeObservation:()=>false}),
  './voice-v2/raw-assistant-wire.mjs':await synthetic('raw',{consumeBoundedRawJson(){throw Error('No assistant transport');},RAW_ASSISTANT_LIMITS:{sessionBytes:65536}}),
  '../../../packages/veyra-operations/core126-image-contract.mjs':await synthetic('hash',{hash}),
  './dot-v2/job-bootstrap-frame.mjs':await synthetic('parser',{parseStrictJobJson}),
  './dot-v2/candidate-control-context.mjs':await synthetic('control',{createOriginalCandidateControlContext(id){contexts++;events.push('negative-context');assert.equal(id,run);if(options.contextMissing)throw Error('Fixture original control unavailable');return control;}}),
  './dot-v2/core126-runtime.js':await synthetic('core',{actualManagedJobOwner:()=>({owner})}),
  './dot-v2/dot-original-context.js':await synthetic('context',{withPersistedOriginalCandidateOperation:async(id,work)=>{assert.equal(id,run);return work(originalContext);}}),
  './dot-v2/manager-connection-source.mjs':await synthetic('connection',{openOriginalManagerConnection(){throw Error('No real original connection');},readOriginalManagerConnection(){throw Error('No real original connection');},closeOriginalManagerConnection(){throw Error('No real original connection');}}),
  './dot-v2/candidate-rpc-identity.mjs':await synthetic('identity',{
   requireOriginalCandidateManagerRpcIdentity:async()=>Object.freeze({}),
   createOriginalCandidateManagerRpcRequest(_identity,id){network++;assert.equal(id,run);if(options.constructorFailure)throw Error('Fixture original constructor refused');const request=new EventEmitter();request.on('error',()=>{});request.destroy=()=>{};queueMicrotask(()=>{events.push('original-request-error');request.emit('error',Error('Fixture original raw request error'));request.emit('error',Error('Fixture duplicate raw error'));});return request;},
   closeOriginalCandidateManagerRpcIdentity(){events.push('identity-closed');},
   refreshOriginalCandidateManagerRpcIdentity(){throw Error('No positive source');},
   assertOriginalCandidateManagerRpcIdentity(){throw Error('No positive source');},
   requireOriginalCandidateRpcFacts(){throw Error('No positive phase');},
   requireOriginalCandidateRpcWithdrawalControl(){throw Error('No withdrawal fixture');}
  })
 };
 const source=stripTypeScriptTypes(readFileSync(root+'/services/ingenium-api/lib/runtime-manager-client.ts','utf8'));
 const module=new SourceTextModule(source,{context,importModuleDynamically:async name=>{assert.ok(modules[name],name);return modules[name];}});await module.link(name=>{assert.ok(modules[name],name);return modules[name];});await module.evaluate();api=module.namespace;
 await assert.rejects(api.launchOriginalManagedCandidateRun(run));
 return {api,binding,control,events,handle,facts,counts:()=>({retains,contexts,finalControls,executeReads,network})};
}
test('original terminal event records uncertainty once in final negative transaction before promise close',async()=>{
 const f=await fixture();assert.deepEqual(f.counts(),{retains:1,contexts:1,finalControls:1,executeReads:0,network:1});assert.equal(f.facts.code,'runtime_owner_unknown');assert.ok(Number.isSafeInteger(f.facts.observedAtMs));assert.deepEqual(f.events,['original-request-error','negative-context','control-snapshot','begin-final-transaction','final-control','negative-cas','end-final-transaction','identity-closed']);
 assert.throws(()=>f.api.spendOriginalCandidateRpcUnknown(f.handle,f.binding,f.control),/UNKNOWN_HANDLE_REQUIRED/);
 assert.throws(()=>f.api.spendOriginalCandidateRpcPhase(f.handle,'ready',f.binding,f.control));
 await assert.rejects(f.api.launchOriginalManagedCandidateRun(run),/ALREADY_SEEN/);
});
for(const options of [{contextMissing:true},{bindingChanged:true},{writeFailure:true}])test('terminal persistence failure never retries, renews execute approval or conceals original rejection '+JSON.stringify(options),async()=>{
 const f=await fixture(options);assert.ok(f.counts().contexts<=1&&f.counts().retains<=1);assert.equal(f.counts().executeReads,0);assert.equal(f.facts,undefined);assert.equal(f.events.at(-1),'identity-closed');await assert.rejects(f.api.launchOriginalManagedCandidateRun(run),/ALREADY_SEEN/);
});
test('no original request means no negative constructor/ledger write',async()=>{const f=await fixture({constructorFailure:true});assert.deepEqual(f.counts(),{retains:0,contexts:0,finalControls:0,executeReads:0,network:1});assert.equal(f.facts,undefined);});
test('an already unknown lifecycle is preserved without duplicate record/revision',async()=>{const f=await fixture({alreadyUnknown:true});assert.deepEqual(f.counts(),{retains:0,contexts:1,finalControls:0,executeReads:0,network:1});assert.equal(f.facts,undefined);});
test('copied terminal data never constructs private outcome authority',async()=>{const f=await fixture();for(const fake of [{},true,Promise.resolve({}),f.facts,{...f.handle}])assert.throws(()=>f.api.spendOriginalCandidateRpcUnknown(fake,f.binding,f.control));assert.equal(f.counts().retains,1);});