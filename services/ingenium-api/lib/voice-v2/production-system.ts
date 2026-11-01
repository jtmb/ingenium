import {isAbsolute,resolve} from 'node:path';
import {createVoiceOperationOwner} from 'ingenium-core';
import {createLinuxCpuSupervisor} from './linux-cpu-admission.mjs';
import type {ManagedCpuSupervisor} from './managed-supervisor.mjs';
import {
 bindHostedVoiceCpuContext,currentHostedVoiceScope,requireHostedVoiceResource,
 verifyHostedVoiceRetirement,hostedOriginalAssistantSources,type HostedVoiceRequestContext,
} from './request-context.js';

type Producer=ManagedCpuSupervisor<HostedVoiceRequestContext>;
type State={kind:'ready';producer:Producer}|{kind:'unavailable';failure:Error};
let original:State|undefined;
function unavailable(cause?:unknown):never {
 if(original?.kind==='unavailable')throw original.failure;
 const failure=Object.assign(Error('VOICE_PRODUCTION_UNAVAILABLE'),{code:'VOICE_PRODUCTION_UNAVAILABLE',status:503,cause});
 original={kind:'unavailable',failure};throw failure;
}
/** One lazy API-process owner. These are server configuration paths, never HTTP
 * fields. Construction reads the protected, measured inputs but starts no CPU,
 * model, child or call. It creates no approval and retries no failed original.
 * Every public operation still requires the genuine fresh request/context.
 */
export function getHostedVoiceProductionProducer():Producer {
 if(original?.kind==='ready')return original.producer;
 if(original?.kind==='unavailable')throw original.failure;
 try{
  if(process.platform!=='linux')return unavailable();
  const profilePath=process.env.INGENIUM_VOICE_CPU_PROFILE_FILE;
  const resourceApprovalPath=process.env.INGENIUM_VOICE_CPU_RESOURCE_APPROVAL_FILE;
  for(const value of[profilePath,resourceApprovalPath])
   if(typeof value!=='string'||!value||value!==value.trim()||!isAbsolute(value)||resolve(value)!==value)return unavailable();
  const ledger=createVoiceOperationOwner<HostedVoiceRequestContext>({
   currentScope:currentHostedVoiceScope,requireOriginalResource:requireHostedVoiceResource,
   verifyRetirement:verifyHostedVoiceRetirement,originalAssistantSources:hostedOriginalAssistantSources,
  });
  const producer=createLinuxCpuSupervisor<HostedVoiceRequestContext>({
   profilePath:profilePath!,resourceApprovalPath:resourceApprovalPath!,ledger,
   bindContext:bindHostedVoiceCpuContext,currentScope:currentHostedVoiceScope,
  });
  original={kind:'ready',producer};return producer;
 }catch(error){return unavailable(error);}
}