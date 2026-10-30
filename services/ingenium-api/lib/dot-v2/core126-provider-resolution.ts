import {AsyncLocalStorage} from "node:async_hooks";
import {createHash} from "node:crypto";
import {getDb,vault} from "ingenium-core";
import {resolveJobProviderModel} from "../job-native-provider.js";
import type {Core126Facts} from "./managed-job-contracts.mjs";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const binding=(provider:any)=>hash([provider.connectionId,provider.providerKey,provider.authentication,provider.config]);
const source=(f:Core126Facts)=>hash([f.run.id,f.run.job_id,f.run.authorization_revision,f.job.id,f.job.revision,f.job.schedule_revision,f.job.service_principal_id,f.runtime.id,f.runtime.revision,f.runtime.backendContainerId,f.workspace.id,f.workspace.storageMappingHash,f.workspace.securityEpoch]);
const fail=():never=>{throw Object.assign(Error("Managed JobRun current original provider resolution unavailable"),{status:503});};
/** Resolve catalog/model work BEFORE acquiring a five-second image observation.
 * Only nonsecret results enter this lexical scope; every consumption rechecks
 * the original Core connection, source facts and current vault provider owner. */
export function createOriginalManagedProviderResolution(){
 const local=new AsyncLocalStorage<{database:ReturnType<typeof getDb>;sourceHash:string;bindingHash:string;model:string;active:boolean}>();
 return Object.freeze({
  async withResolved<T>(facts:Core126Facts,work:()=>T|Promise<T>):Promise<T>{
   const database=getDb(),sourceHash=source(facts);let provider=vault.resolveJobProviderRuntime(facts.job.project_id,facts.job.id,facts.run.id);
   const bindingHash=binding(provider);let model:string;
   try{if(provider.authentication!=="anonymous"||provider.providerKey!=="opencode")throw Error("Managed JobRun provider secret handoff unavailable");model=await resolveJobProviderModel(provider);}finally{provider.release();}
   if(database!==getDb()||source(facts)!==sourceHash)return fail();
   provider=vault.resolveJobProviderRuntime(facts.job.project_id,facts.job.id,facts.run.id);
   try{if(binding(provider)!==bindingHash)return fail();}finally{provider.release();}
   const resolution={database,sourceHash,bindingHash,model,active:true};
   try{return await local.run(resolution,work);}finally{resolution.active=false;}
  },
  current(facts:Core126Facts):Readonly<{bindingHash:string;model:string}>{
   const original=local.getStore();if(!original?.active||original.database!==getDb()||original.sourceHash!==source(facts))return fail();
   const provider=vault.resolveJobProviderRuntime(facts.job.project_id,facts.job.id,facts.run.id);
   try{if(binding(provider)!==original.bindingHash)return fail();}finally{provider.release();}
   return {bindingHash:original.bindingHash,model:original.model};
  },
 });
}