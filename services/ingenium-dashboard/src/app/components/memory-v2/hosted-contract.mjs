// Hosted-project presentation checks. The server still authenticates every call.
const fail = () => { throw new TypeError('Hosted memory binding unavailable'); };
export const text = v => typeof v === 'string' && v.length > 0 && v.length <= 512 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
export const integer = v => Number.isSafeInteger(v) && v >= 0;
export const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const selectionFields = ['actorUserId','organizationId','workspaceId','runtimeId','engineSessionId'];
// Retain the existing durable comparison layout. Project ID is acquired from
// the server-owned workspace, never from RuntimeContext.projectName.
const bindingFields = ['actorUserId','organizationId','projectId','workspaceId','runtimeId','engineSessionId',
  'contextConversationId','scopeHash','bindingHash','bindingEpoch'];
export function hostedSelection(value) {
  const keys=value&&Object.hasOwn(value,'expectedProjectId')?[...selectionFields,'expectedProjectId']:selectionFields;
  if (!exact(value, keys) || selectionFields.some(k => !text(value[k]))
    || value.runtimeId==='compatibility'
    || (value.expectedProjectId!==undefined&&!text(value.expectedProjectId))) fail();
  // Missing client Project ID is just a workspace lookup, not projectless scope.
  return Object.freeze(Object.fromEntries([...selectionFields,
    ...(value.expectedProjectId===undefined?[]:['expectedProjectId'])].map(k => [k,value[k]])));
}
export function sameSelection(a,b) { return selectionFields.every(k => a?.[k] === b?.[k])
  && (b?.expectedProjectId===undefined||a?.projectId===b.expectedProjectId); }
export function hostedBinding(value, selected) {
  hostedSelection(selected);
  if (!exact(value, [...bindingFields,'schemaVersion','available','canChange','canForget'])
    || value.schemaVersion !== 1 || value.available !== true || !sameSelection(value,selected)
    || !text(value.projectId) || !text(value.contextConversationId) || !hash(value.scopeHash) || !hash(value.bindingHash)
    || !integer(value.bindingEpoch) || typeof value.canChange !== 'boolean' || typeof value.canForget !== 'boolean') fail();
  return Object.freeze({ ...value });
}
export function sameBinding(a,b) { return bindingFields.every(k => a?.[k] === b?.[k]); }
export function controllerBinding(binding) {
  return Object.freeze({ scopeKey:JSON.stringify(bindingFields.map(k => binding[k])), scopeHash:binding.scopeHash,
    chatId:binding.engineSessionId, bindingHash:binding.bindingHash, bindingEpoch:binding.bindingEpoch });
}
export function validateInspection(body, offset, limit) {
  const window=body?.sourceWindow, rows=body?.data?.items;
  if (!Array.isArray(rows) || rows.length>limit || !window || window.candidateOffset!==offset || window.limit!==limit
    || !integer(window.scanned) || window.scanned>limit || typeof window.hasMore!=='boolean'
    || (window.hasMore ? window.nextCandidateOffset!==offset+limit : window.nextCandidateOffset!==null)
    || !integer(window.returned) || window.returned!==rows.length
    || !integer(window.unavailableMemoryCount) || !integer(window.deferredForSourceBudget)) fail();
  const ids=new Set();
  for (const row of rows) {
    if(!text(row.id)||ids.has(row.id)||!integer(row.version)||row.version<1||typeof row.content!=='string'||row.content.length>8192
      ||!text(row.provenance?.model)||!Array.isArray(row.provenance.sources)||row.provenance.sources.length<1||row.provenance.sources.length>32) fail();
    ids.add(row.id);
    const sources=new Set();
    for(const source of row.provenance.sources) {
      if(!text(source.id)||sources.has(source.id)||!text(source.chatId)||!hash(source.contentHash)
        ||!['transcript','tool','external'].includes(source.kind))fail();
      sources.add(source.id);
    }
  }
  // No synthesized qualified total and no claim that a model consumed this GET.
  return { items:rows, sourceWindow:window };
}
export function policyReceipt(value, record) {
  if(value?.status!=='committed'||value.scopeHash!==record.identity.scopeHash||value.operationId!==record.operationId
    ||value.operation!==(record.change.target==='host'?'policy':'chat-policy')||value.revision!==record.change.expectedRevision+1)fail();
  return value;
}
export function managementReceipt(value, record) {
  if(value?.status!=='committed'||value.scopeHash!==record.scopeHash||value.operationId!==record.operationId||value.operation!==record.action
    ||!integer(value.forgottenCount)||(record.action==='forget'&&(value.memoryId!==record.memoryId||value.version!==record.expectedVersion+1)))fail();
  return value;
}
export function definitiveRejection(error) {
  return ({401:['UNAUTHORIZED','AUTH_REQUIRED'],403:['FORBIDDEN'],404:['NOT_FOUND'],
    409:['VERSION_CONFLICT','OPERATION_CONFLICT','RESET_CHANGED'],422:['INVALID_INPUT','INVALID_SCOPE']})[error?.status]?.includes(error?.code)===true;
}
