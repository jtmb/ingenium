import { createHash } from 'node:crypto';
import { MemoryError, scopeKey } from './lifecycle.mjs';
const snapshots = new WeakMap();
const axes = ['organizationId','ownerUserId','projectId','workspaceId','hostId','environmentId','bindingHash','bindingEpoch','visibility'];
const hash = value => createHash('sha256').update(value).digest('hex');
const sameScope = (a,b) => axes.every(key => a?.[key] === b?.[key]);
const safeTime = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const fail = () => { throw new MemoryError('SOURCE_UNAVAILABLE'); };
export const COMPLETED_SNAPSHOT_LIMITS = Object.freeze({ maxBytes:8*1024*1024,maxRecordBytes:1024*1024,maxMessages:32 });

/** Internal server composition. capture/read ports must use the canonical original
 * engine owner; a browser-authored Context checkpoint is never engine proof.
 * Capture once per extraction job. No sender, journal, timer or persistent copy.
 */
export function createCompletedMemorySnapshot({ scope, execution, chatId, minRolloutIdleHours, captureSnapshot, readCanonicalMessage, nowMs=Date.now() }) {
  scopeKey(scope);
  if (!id(chatId) || !safeTime(nowMs) || !Number.isInteger(minRolloutIdleHours) || minRolloutIdleHours<1 || minRolloutIdleHours>48
    || typeof captureSnapshot!=='function' || typeof readCanonicalMessage!=='function') fail();
  const captured = captureSnapshot({ scope,execution,chatId,maxBytes:COMPLETED_SNAPSHOT_LIMITS.maxBytes,maxRecordBytes:COMPLETED_SNAPSHOT_LIMITS.maxRecordBytes,maxMessages:32 });
  if (!captured || !sameScope(captured.scope,scope) || captured.runtimeId!==execution.runtimeId || captured.chatId!==chatId
    || !id(captured.ownerInstanceId) || !id(captured.watermark) || !safeTime(captured.capturedAtMs) || captured.capturedAtMs>nowMs
    || !safeTime(captured.lastActivityAtMs) || captured.lastActivityAtMs>captured.capturedAtMs
    || captured.capturedAtMs-captured.lastActivityAtMs<minRolloutIdleHours*3_600_000
    || typeof captured.externalContextUsed!=='boolean' || !Array.isArray(captured.messages)
    || captured.messages.length<2 || captured.messages.length>32 || captured.messages.length%2!==0) fail();
  // Copy primitives before retaining; the owner cannot mutate selected evidence later.
  const messages = captured.messages.map(message => {
    if (!message || !id(message.id) || !id(message.revision) || !id(message.turnId) || !id(message.terminalAssistantId)
      || !['user','assistant'].includes(message.role) || typeof message.content!=='string' || message.completion!=='complete'
      || !safeTime(message.completedAtMs) || message.completedAtMs>captured.lastActivityAtMs) fail();
    const copy = {id:message.id,revision:message.revision,turnId:message.turnId,terminalAssistantId:message.terminalAssistantId,
      role:message.role,content:message.content,completion:'complete',completedAtMs:message.completedAtMs};
    if (Buffer.byteLength(JSON.stringify(copy),'utf8')>COMPLETED_SNAPSHOT_LIMITS.maxRecordBytes) fail();
    return Object.freeze(copy);
  });
  if (new Set(messages.map(message=>message.id)).size!==messages.length) fail();
  for(let index=0;index<messages.length;index+=2) {
    const user=messages[index],assistant=messages[index+1];
    if(user.role!=='user'||assistant.role!=='assistant'||user.turnId!==assistant.turnId
      ||user.terminalAssistantId!==assistant.id||assistant.terminalAssistantId!==assistant.id
      ||user.completedAtMs!==assistant.completedAtMs) fail();
  }
  const evidence = {scope:{...scope},runtimeId:execution.runtimeId,chatId,ownerInstanceId:captured.ownerInstanceId,watermark:captured.watermark,
    capturedAtMs:captured.capturedAtMs,lastActivityAtMs:captured.lastActivityAtMs,externalContextUsed:captured.externalContextUsed,
    minRolloutIdleHours,messages};
  if(Buffer.byteLength(JSON.stringify(evidence),'utf8')>COMPLETED_SNAPSHOT_LIMITS.maxBytes) fail();
  const selectedSources=Object.freeze(messages.map(message=>Object.freeze({engineMessageId:message.id,role:message.role,contentHash:hash(message.content),terminalAssistantId:message.terminalAssistantId})));
  const snapshot = Object.freeze({version:'completed-source-snapshot-v1',fingerprint:hash(JSON.stringify(evidence)),messageCount:messages.length,selectedSources});
  snapshots.set(snapshot,{...evidence,scope:Object.freeze(evidence.scope),messages:Object.freeze(messages),readCanonicalMessage});
  return snapshot;
}

/** Recheck the selected source, not material appended after capture. Every read is
 * via the original owner and exact old message ID/revision; unknown is not absent.
 */
export function readCompletedSnapshotSource(snapshot,{scope,execution,chatId,engineMessageId,role,content,contentHash,minRolloutIdleHours}) {
  const saved=snapshots.get(snapshot);
  if(!saved || !sameScope(saved.scope,scope) || saved.runtimeId!==execution.runtimeId || saved.chatId!==chatId
    || saved.minRolloutIdleHours!==minRolloutIdleHours || typeof content!=='string' || hash(content)!==contentHash) return null;
  const source=saved.messages.find(message=>message.id===engineMessageId);
  if(!source || source.role!==role || source.content!==content) return null;
  // Revalidate the completed pair so a retained user cannot outlive a revoked terminal.
  const pair=saved.messages.filter(message=>message.turnId===source.turnId);
  if(pair.length!==2) return null;
  for(const expected of pair) {
    const current=saved.readCanonicalMessage({scope,execution,chatId,ownerInstanceId:saved.ownerInstanceId,
      watermark:saved.watermark,messageId:expected.id,revision:expected.revision});
    if(!current || current.ownerInstanceId!==saved.ownerInstanceId || current.externalContextUsed!==saved.externalContextUsed
      || ['id','revision','turnId','terminalAssistantId','role','content','completion','completedAtMs'].some(key=>current[key]!==expected[key])) return null;
  }
  return {userMessageId:pair[0].id,userContentHash:hash(pair[0].content),terminalAssistantId:source.terminalAssistantId,terminalContentHash:hash(pair[1].content),externalContextUsed:saved.externalContextUsed,
    eligibilityVersion:`snapshot-v1:${snapshot.fingerprint}`};
}
