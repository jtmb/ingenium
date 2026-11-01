/** Browser display checks; the original API owns saved-data authorization. */
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const count=v=>Number.isSafeInteger(v)&&v>=0,hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),date=v=>text(v,64)&&Number.isFinite(Date.parse(v));
export function createSavedHistoryClient(request,scope){
 if(typeof request!=='function'||!uuid(scope?.ownerUserId)||!uuid(scope?.organizationId))throw Error('Choose your current organization.');
 const ownerUserId=scope.ownerUserId,organizationId=scope.organizationId,base='/workspace-context/history',query=new URLSearchParams({organizationId});
 function conversation(c){if(!c||c.version!==1||c.kind!=='saved-workspace-chat'||!uuid(c.id)||!text(c.title,256)||!date(c.createdAt)||!count(c.revision)||typeof c.archived!=='boolean'||c.scope?.ownerUserId!==ownerUserId||c.scope?.organizationId!==organizationId||!/^[a-f0-9]{32}$/.test(c.scope?.instanceId)||!text(c.source?.workspaceId,256)||!uuid(c.source?.runtimeId)||!hex(c.source?.executionGeneration)||!text(c.source?.engineSessionId,512)||!hex(c.source?.snapshotHash))throw Error('Saved conversation scope changed. Refresh history.');return c}
 async function list({workspaceId=null,includeArchived=false,afterCreatedAt='',afterId=''}={}){
  if(workspaceId!==null&&!text(workspaceId,256)||typeof includeArchived!=='boolean'||Boolean(afterCreatedAt)!==Boolean(afterId)||afterCreatedAt&&!date(afterCreatedAt)||afterId&&!uuid(afterId))throw Error('Invalid saved history page.');
  const q=new URLSearchParams(query);q.set('limit','30');q.set('includeArchived',String(includeArchived));if(workspaceId)q.set('workspaceId',workspaceId);if(afterId){q.set('afterId',afterId);q.set('afterCreatedAt',afterCreatedAt)}
  const page=await request(base+'?'+q),seen=new Set();let prior=afterId?{createdAt:afterCreatedAt,id:afterId}:null,instance=null;
  if(!Array.isArray(page?.data)||page.data.length>30||typeof page.pagination?.hasMore!=='boolean'||typeof page.pagination?.afterCreatedAt!=='string'||typeof page.pagination?.afterId!=='string')throw Error('Saved history page could not be verified.');
  for(const raw of page.data){const c=conversation(raw);if(seen.has(c.id)||workspaceId!==null&&c.source.workspaceId!==workspaceId||!includeArchived&&c.archived||instance!==null&&c.scope.instanceId!==instance||prior&&(c.createdAt>prior.createdAt||c.createdAt===prior.createdAt&&c.id>=prior.id))throw Error('Saved history page changed. Refresh history.');seen.add(c.id);instance=c.scope.instanceId;prior=c}
  if(page.data.length&&(page.pagination.afterId!==prior.id||page.pagination.afterCreatedAt!==prior.createdAt)||!page.data.length&&(page.pagination.hasMore||page.pagination.afterId!==afterId||page.pagination.afterCreatedAt!==afterCreatedAt))throw Error('Saved history cursor did not advance.');return page;
 }
 async function get(id,{afterSequence=-1,expectedRevision}={}){
  if(!uuid(id)||!Number.isSafeInteger(afterSequence)||afterSequence< -1||expectedRevision!==undefined&&!count(expectedRevision))throw Error('Choose a saved conversation.');
  const q=new URLSearchParams(query);q.set('limit','20');q.set('afterSequence',String(afterSequence));if(expectedRevision!==undefined)q.set('expectedRevision',String(expectedRevision));
  const page=(await request(base+'/'+id+'?'+q))?.data,c=conversation(page?.conversation);
  if(c.id!==id||expectedRevision!==undefined&&c.revision!==expectedRevision||!Array.isArray(page.messages)||page.messages.length>20||typeof page.pagination?.hasMore!=='boolean'||!Number.isSafeInteger(page.pagination?.afterSequence)||!count(page.verifiedContentBytes)||!count(page.serializedMessageBytes))throw Error('Saved conversation page changed. Refresh history.');
  let sequence=afterSequence;const seen=new Set();for(const m of page.messages){if(!uuid(m?.id)||seen.has(m.id)||m.sequence!==++sequence||m.sequence>=c.revision||!['user','assistant'].includes(m.role)||!text(m.content,262144)||!hex(m.contentHash)||!date(m.createdAt)||!text(m.sourceMessageId,512))throw Error('Saved message could not be verified.');seen.add(m.id)}
  if(page.pagination.afterSequence!==sequence||page.pagination.hasMore!==(sequence<c.revision-1)||page.pagination.hasMore&&!page.messages.length)throw Error('Saved message cursor did not advance.');return page;
 }
 return {list,get};
}
