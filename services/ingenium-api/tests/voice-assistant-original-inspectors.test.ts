import {test,expect} from 'vitest';
import {inspectHostedAssistantSourceOriginal,inspectOriginalAssistantCallForFence,inspectHostedAssistantCpuDispatch,type HostedVoiceRequestContext} from '../lib/voice-v2/request-context.js';
import {ManagedCpuSupervisor} from '../lib/voice-v2/managed-supervisor.mjs';

test('copied plan/call/context data never reaches actual source/CPU authority',()=>{
 const forged=Object.freeze({sourceId:'source',callId:'call',operationId:'operation',scope:{actorId:'actor'}});
 expect(()=>inspectHostedAssistantSourceOriginal({} as HostedVoiceRequestContext,forged)).toThrow('CALL_PLAN_ORIGINAL_REQUIRED');
 expect(()=>inspectOriginalAssistantCallForFence(forged)).toThrow('CALL_ORIGINAL_REQUIRED');
 expect(()=>inspectHostedAssistantCpuDispatch({} as HostedVoiceRequestContext,forged)).toThrow('VOICE_CONTEXT_UNAVAILABLE');
});

test('ordinary legacy supervisor cannot silently acquire new assistant source ports',()=>{
 let entered=0;
 const noEffect=()=>{entered++;throw Error('No authenticated fixture effect may enter');};
 const ledger=Object.fromEntries(['reserveControl','listControls','reserve','privateRead','retireOriginal','settle'].map(key=>[key,noEffect]));
 // Explicit inert dependency fixture. No protected profile, original Core,
 // authenticated scope or positive resource is supplied or fabricated.
 const supervisor=new ManagedCpuSupervisor({profile:{helperSource:'inert',witnessSource:'inert',settings:{instance_id:'fixture'},value:{defaultVoice:'af_heart'}},ledger,bindContext:noEffect,admitCpu:noEffect,requireCpuAdmission:noEffect,releaseCpu:noEffect,admitCpuWitness:noEffect,releaseCpuWitness:noEffect} as never);
 expect(supervisor.status().ready).toBe(false);
 expect(()=>supervisor.reserveOriginalAssistantSource({},{})).toThrow('CPU_ASSISTANT_SOURCE_LEDGER_UNAVAILABLE');
 expect(()=>supervisor.inspectOriginalAssistantCpuDispatch({},{})).toThrow('CPU_ASSISTANT_SOURCE_LEDGER_UNAVAILABLE');
 expect(()=>supervisor.reserveAttachedAssistantCpu({kind:'transcribe'} as never,{} as never)).toThrow('CPU_ASSISTANT_INPUT_INVALID');
 expect(entered).toBe(0);
});
