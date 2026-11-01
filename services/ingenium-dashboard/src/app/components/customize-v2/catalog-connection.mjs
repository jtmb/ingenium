/** Browser intent journal only. Every command and receipt is authorized again by
 * the canonical session-owned API. Unknown outcomes are inspected, never replayed. */
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const target=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v);
const prefix='veyra:catalog-connect:v1:';
export function createCatalogConnection({entry,request,storage,randomUUID}){
 const c=entry?.catalog,kind=entry?.kind;
 if(!c||!['plugin','skill'].includes(kind)||!uuid(c.sourceId)||!uuid(c.projectId)||!hash(c.sourceSha256)||!Number.isSafeInteger(c.sourceRevision)||c.sourceRevision<0||typeof entry.scopeId!=='string'||!entry.scopeId||entry.scopeId.length>2048||typeof request!=='function'||!storage||typeof randomUUID!=='function')throw Error('An explicit catalog target and available recovery storage are required.');
 const key=prefix+JSON.stringify([entry.scopeId,kind,c.sourceId,c.projectId]);
 let busy=false;
 const read=()=>{
  const raw=storage.getItem(key);if(raw===null)return null;
  if(typeof raw!=='string'||raw.length>4096)throw Error('The saved connection needs review; no command was sent.');
  let j;try{j=JSON.parse(raw)}catch{throw Error('The saved connection needs review; no command was sent.')}
  const q=j?.command;
  if(j?.version!==1||j.scopeId!==entry.scopeId||j.kind!==kind||!q||Object.keys(q).sort().join(',')!=='expectedRevision,op,operationId,projectId,sourceId,sourceSha256,targetName'||q.op!=='connect'||!uuid(q.operationId)||q.sourceId!==c.sourceId||q.projectId!==c.projectId||!hash(q.sourceSha256)||!Number.isSafeInteger(q.expectedRevision)||q.expectedRevision<0||!target(q.targetName))throw Error('The saved connection target does not match; no command was sent.');
  return j;
 };
 function accept(response,j){
  const r=response?.data,q=j.command;
  if(!r||r.operationId!==q.operationId||!hash(r.payloadSha256)||!['succeeded','unknown','refused'].includes(r.outcome))throw Error('The server receipt could not be verified. Check this operation again.');
  if(r.outcome==='succeeded'){
   const v=r.value;
   if(!v||!uuid(v.installationId)||v.kind!==kind||v.projectId!==q.projectId||v.sourceSha256!==q.sourceSha256||(kind==='plugin'?(!uuid(v.resourceId)||v.proposalId!==null||v.state!=='staged-disabled'):(v.resourceId!==null||!uuid(v.proposalId)||v.state!=='proposal-review-required')))throw Error('The completed connection does not match this operation. Check its receipt again.');
  }
  return {outcome:r.outcome,operationId:q.operationId,targetName:q.targetName,sourceChanged:q.sourceSha256!==c.sourceSha256||q.expectedRevision!==c.sourceRevision,...(r.outcome==='succeeded'?{value:r.value}:{})};
 }
 async function inspect(){
  if(busy)throw Error('A connection check is already running.');busy=true;
  try{const j=read();if(!j)return null;return accept(await request('/customize/commands/'+encodeURIComponent(j.command.operationId)),j)}finally{busy=false}
 }
 async function connect(name){
  if(busy)throw Error('A connection is already running.');busy=true;
  try{
   if(read())throw Error('This connection already has an operation. Check its status before starting another.');
   if(!entry.actions?.includes('connect')||entry.installed)throw Error('This catalog entry is not available to connect.');
   if(!target(name))throw Error('Use 1–64 letters, numbers, dots, underscores or hyphens; start with a letter or number.');
   let count=0;for(let i=0;i<storage.length;i++)if(storage.key(i)?.startsWith(prefix))count++;
   if(count>=32)throw Error('Connection history is full. Review existing connection operations before adding another.');
   const operationId=randomUUID();if(!uuid(operationId))throw Error('A secure operation ID could not be created.');
   const j={version:1,scopeId:entry.scopeId,kind,command:{operationId,op:'connect',sourceId:c.sourceId,expectedRevision:c.sourceRevision,sourceSha256:c.sourceSha256,projectId:c.projectId,targetName:name}};
   const serialized=JSON.stringify(j);storage.setItem(key,serialized);
   if(storage.getItem(key)!==serialized)throw Error('Recovery storage could not retain this operation. No command was sent.');
   return accept(await request('/customize/commands',{method:'POST',body:JSON.stringify(j.command)}),j);
  }finally{busy=false}
 }
 return {pending:()=>read()?.command??null,connect,inspect};
}
