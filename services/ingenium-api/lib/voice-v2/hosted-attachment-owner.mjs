import { createHash } from 'node:crypto';
import { assertAttachedPromptInboxAck } from './attached-call-protocol.mjs';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
/** Root constructs once from actual request-context additions, SAME Core SQL132
 * writer, opencode-client.request/streamEvents, and original agent control owner.
 * No event observer or positive execution/retirement proof can be injected here.
 */
export function createHostedAttachmentOwner({ withSelected, assertCurrent, ledger, request, streamEvents, agentControlOwner }) {
  if (typeof withSelected !== 'function' || typeof assertCurrent !== 'function' || typeof request !== 'function'
    || typeof streamEvents !== 'function' || ['reserve','claim','acknowledge','unknown'].some(k => typeof ledger?.[k] !== 'function')) fail('CALL_ACTUAL_OWNER_CONSTRUCTORS_REQUIRED');
  const selected = new WeakMap();
  const current=(context,scope,action)=>{if(assertCurrent(context,scope,action)!==undefined)fail('CALL_CONTEXT_ASSERTION_MUST_BE_SYNCHRONOUS_VOID');};
  async function bound(context, scope, action, effect) {
    return withSelected(context,scope,action,async binding => {
      const selection=hash([binding.scope,binding.sessionId,binding.directory,binding.agentId,binding.modelId,binding.providerId,binding.variant,binding.configurationRevision]);
      if(selected.has(context)&&selected.get(context)!==selection)fail('CALL_SELECTION_CHANGED');
      selected.set(context,selection);
      current(context,scope,action);return effect(binding);
    });
  }
  return Object.freeze({
    inspect:(context,scope,action)=>bound(context,scope,action,binding=>binding),
    openEvents:(context,scope,{cursor,signal})=>bound(context,scope,'read',binding=>{
      signal.throwIfAborted();return streamEvents(binding.sessionId,binding.directory,cursor,signal);
    }),
    deliverMessage:(context,scope,message)=>bound(context,scope,'message',async binding=>{
      if(!message||Object.keys(message).sort().join()!=='delivery,nativeMessageId,requestId,text'
        ||typeof message.text!=='string'||!message.text.trim()||[...message.text].length>2000
        ||!['queue','steer'].includes(message.delivery)||!/^msg_[A-Za-z0-9_-]{1,124}$/.test(message.nativeMessageId??''))fail('CALL_MESSAGE_INVALID');
      const input={scope,requestId:message.requestId,kind:'message',originalMessageId:message.nativeMessageId,
        inputHash:hash([message.text,message.delivery,binding.configurationRevision])};
      const retained=ledger.reserve(context,input);
      if(!retained.fresh)return {sessionId:binding.sessionId,nativeMessageId:message.nativeMessageId,state:retained.receipt.state};
      try {
        // Same selected engine's durable prompt/inbox queue. No model/agent/
        // variant/system/tools switches, synthetic session or transcript copy.
        current(context,scope,'message');ledger.claim(retained.handle);
        const result=await request(`/api/session/${encodeURIComponent(binding.sessionId)}/prompt`,{
          method:'POST',body:{id:message.nativeMessageId,text:message.text,delivery:message.delivery},
        });
        const ack=result?.data;
        assertAttachedPromptInboxAck(result,{sessionId:binding.sessionId,messageId:message.nativeMessageId,text:message.text,delivery:message.delivery});
        const receipt=ledger.acknowledge(retained.handle,{originalMessageId:message.nativeMessageId,sessionId:binding.sessionId,state:'delivered'});
        return {sessionId:binding.sessionId,nativeMessageId:message.nativeMessageId,state:receipt.state};
      } catch(error) {
        // Failure to record unknown is itself retained as a failure; never retry
        // the send or manufacture an ACK from a later matching message.
        ledger.unknown(retained.handle);throw error;
      }
    }),
    cancelAgent:(context,scope,command)=>bound(context,scope,'cancel-agent',async binding=>{
      if(command.intent!=='explicit-user-cancel-agent')fail('CALL_EXPLICIT_AGENT_CANCEL_REQUIRED');
      if(typeof agentControlOwner?.captureCancel!=='function')fail('CALL_AGENT_CANCEL_OWNER_UNKNOWN');
      const original=await agentControlOwner.captureCancel(context,scope,command);
      if(!original||typeof original.dispatch!=='function'||typeof original.originalMessageId!=='string')fail('CALL_AGENT_CANCEL_OWNER_UNKNOWN');
      const input={scope,requestId:command.requestId,kind:'cancel-agent',originalMessageId:original.originalMessageId,
        inputHash:hash([command.intent,original.originalMessageId,binding.configurationRevision])};
      const retained=ledger.reserve(context,input);if(!retained.fresh)return {state:retained.receipt.state};
      try {
        current(context,scope,'cancel-agent');ledger.claim(retained.handle);
        const dispatched=await original.dispatch();
        if(!dispatched||!['pending','rejected'].includes(dispatched.state))fail('CALL_AGENT_CONTROL_UNKNOWN');
        const receipt=ledger.acknowledge(retained.handle,{originalMessageId:original.originalMessageId,sessionId:binding.sessionId,state:dispatched.state});
        return {state:receipt.state};
      } catch(error) {ledger.unknown(retained.handle);throw error;}
    }),
  });
}
