// Root-only Vitest negatives against actual canonical new client functions.
// No positive fetch mock, auth/DB fixture, engine/model or HTTP service is used.
import {describe,it,expect} from 'vitest';
import {readOriginalRawAssistantMessage,takeOriginalRawAssistantRead,discardOriginalRawAssistantRead,type OriginalRawAssistantRead} from '../lib/opencode-client.js';
import {observeHostedAssistantSpeech,type HostedVoiceRequestContext} from '../lib/voice-v2/request-context.js';
const input=()=>({sessionId:'ses_fixture',messageId:'msg_fixture',agentId:'agent',deadlineAt:Date.now()+1000,signal:new AbortController().signal});
describe('actual raw-client authority negatives; no transport success fixture',()=>{
 it('copied/serialized/frozen JSON has no actual original HTTP owner',()=>{
  for(const value of [{},Object.freeze({}),JSON.parse('{"responseSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bodyEnded":true}')]){
   expect(()=>takeOriginalRawAssistantRead(value as OriginalRawAssistantRead)).toThrow('RAW_READ_ORIGINAL_REQUIRED');
   expect(()=>discardOriginalRawAssistantRead(value as OriginalRawAssistantRead)).toThrow('RAW_READ_ORIGINAL_REQUIRED');
  }
 });
 it('valid-looking selectors without actual scoped target refuse before HTTP',async()=>{
  await expect(readOriginalRawAssistantMessage(input())).rejects.toThrow('RAW_READ_SCOPED_TARGET_REQUIRED');
 });
 it('path/query/traversal/encoding tricks, bad deadlines and DTO text refuse before HTTP',async()=>{
  for(const id of ['../msg_other','msg_x?secret=1','msg_x/other','msg_%2f','msg_#x','msg_\\other'])await expect(readOriginalRawAssistantMessage({...input(),messageId:id})).rejects.toThrow('RAW_READ_INPUT');
  for(const deadlineAt of [0,Date.now()+20000,NaN,1.5])await expect(readOriginalRawAssistantMessage({...input(),deadlineAt})).rejects.toThrow('RAW_READ_INPUT');
  await expect(readOriginalRawAssistantMessage({...input(),text:'caller supplied'} as ReturnType<typeof input>)).rejects.toThrow('RAW_READ_INPUT');
 });
 it('original cancellation before start makes no read capability',async()=>{
  const controller=new AbortController();controller.abort();await expect(readOriginalRawAssistantMessage({...input(),signal:controller.signal})).rejects.toThrow();
 });
 it('a caller DTO cannot become a private hosted context or observation',async()=>{
  await expect(observeHostedAssistantSpeech({} as HostedVoiceRequestContext,'msg_fixture',new AbortController().signal)).rejects.toThrow('VOICE_CONTEXT_UNAVAILABLE');
 });
});
