import {afterEach,expect,test,vi} from 'vitest';
const keys=['INGENIUM_VOICE_CPU_PROFILE_FILE','INGENIUM_VOICE_CPU_RESOURCE_APPROVAL_FILE'] as const;
const saved=keys.map(key=>[key,process.env[key]] as const);
afterEach(()=>{for(const[key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}vi.resetModules();});
test('concrete production owner requires both protected server inputs and latches original unavailable result without an ambient fallback',async()=>{
 for(const key of keys)delete process.env[key];vi.resetModules();
 const {getHostedVoiceProductionProducer}=await import('../lib/voice-v2/production-system.js');
 let failure:unknown;try{getHostedVoiceProductionProducer();}catch(error){failure=error;}
 expect(failure).toMatchObject({code:'VOICE_PRODUCTION_UNAVAILABLE',status:503});
 process.env.INGENIUM_VOICE_CPU_PROFILE_FILE='/not-an-approved-profile';
 process.env.INGENIUM_VOICE_CPU_RESOURCE_APPROVAL_FILE='/not-an-approved-resource-approval';
 expect(()=>getHostedVoiceProductionProducer()).toThrow(failure as Error);
 try{getHostedVoiceProductionProducer();}catch(error){expect(error).toBe(failure);}
});
test('one configured input or noncanonical paths cannot initialize an original production owner',async()=>{
 for(const values of [['/absent-approved-profile',undefined],['relative/profile','/approval'],['/profile/../profile','/approval']]){
  for(let i=0;i<keys.length;i++){const value=values[i];if(value===undefined)delete process.env[keys[i]!];else process.env[keys[i]!]=value;}
  vi.resetModules();const {getHostedVoiceProductionProducer}=await import('../lib/voice-v2/production-system.js');
  expect(()=>getHostedVoiceProductionProducer()).toThrow('VOICE_PRODUCTION_UNAVAILABLE');
 }
});