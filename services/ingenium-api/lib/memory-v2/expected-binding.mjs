import { createHash } from 'node:crypto';
import { MemoryError, scopeKey } from './lifecycle.mjs';
const fields=['X-Veyra-Memory-Scope','X-Veyra-Memory-Binding','X-Veyra-Memory-Epoch','X-Veyra-Memory-Context'];
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
/** Optional legacy compatibility; partial/duplicate/malformed guards never disappear. */
export function expectedMemoryBinding(getHeader) {
  const values=fields.map(name=>getHeader(name));
  if(values.every(v=>v===undefined))return null;
  const [scopeHash,bindingHash,epoch,contextConversationId]=values;
  if(!hash(scopeHash)||!hash(bindingHash)||typeof epoch!=='string'||!/^(0|[1-9][0-9]*)$/.test(epoch)
    ||!Number.isSafeInteger(Number(epoch))||typeof contextConversationId!=='string'||contextConversationId.length<1
    ||contextConversationId.length>512||contextConversationId!==contextConversationId.trim()||/[\u0000-\u001f\u007f,]/.test(contextConversationId))throw new MemoryError('INVALID_INPUT');
  return Object.freeze({scopeHash,bindingHash,bindingEpoch:Number(epoch),contextConversationId});
}
export function assertExpectedMemoryBinding(expected,scope,contextConversationId) {
  if(expected===null)return;
  const scopeHash=createHash('sha256').update(scopeKey(scope)).digest('hex');
  if(expected.scopeHash!==scopeHash||expected.bindingHash!==scope.bindingHash||expected.bindingEpoch!==scope.bindingEpoch
    ||expected.contextConversationId!==contextConversationId)throw new MemoryError('BINDING_CHANGED');
}
