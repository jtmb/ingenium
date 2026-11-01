// Root Vitest actual-canonical negatives. NO auth/CPU/fetch/model positive ports.
import {describe,it,expect} from 'vitest';
import {openHostedCurrentAgentCall,inspectHostedCurrentAgentCall,planHostedCurrentAgentSpeech,inspectHostedCurrentAgentPlan,bargeInHostedCurrentAgentCall,endHostedCurrentAgentCall,prepareHostedCurrentAgentTts,type HostedCurrentAgentCall,type HostedAssistantObservation,type HostedVoiceRequestContext} from '../lib/voice-v2/request-context.js';
describe('actual private call/plan original negatives',()=>{
 it('context DTO cannot open a private call',async()=>{await expect(openHostedCurrentAgentCall({} as HostedVoiceRequestContext,new AbortController().signal)).rejects.toThrow('VOICE_CONTEXT_UNAVAILABLE');});
 it('copied call IDs/generations/profile/scope never become an original call',()=>{
  for(const value of [{},JSON.parse('{"callId":"fixture","generation":0,"profileDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')]){
   const call=value as HostedCurrentAgentCall;expect(()=>inspectHostedCurrentAgentCall(call)).toThrow('CALL_ORIGINAL_REQUIRED');expect(()=>planHostedCurrentAgentSpeech(call,'msg_fixture',new AbortController().signal)).toThrow('CALL_ORIGINAL_REQUIRED');expect(()=>bargeInHostedCurrentAgentCall(call)).toThrow('CALL_ORIGINAL_REQUIRED');expect(()=>endHostedCurrentAgentCall(call)).toThrow('CALL_ORIGINAL_REQUIRED');
  }
 });
 it('JSON observation or hash cannot mint plan or CPU dispatch authority',()=>{
  const call={} as HostedCurrentAgentCall,plan={sourceId:'fixture',text:'caller supplied',planHash:'a'.repeat(64)} as unknown as HostedAssistantObservation;
  expect(()=>inspectHostedCurrentAgentPlan(call,plan)).toThrow('CALL_ORIGINAL_REQUIRED');expect(()=>prepareHostedCurrentAgentTts(call,plan)).toThrow('CALL_ORIGINAL_REQUIRED');
 });
});
