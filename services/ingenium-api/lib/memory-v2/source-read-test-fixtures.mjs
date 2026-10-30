// Test-only in-memory source fixtures. Not imported by production modules.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MemoryLifecycle,scopeKey} from './lifecycle.mjs';
import {createRecallSourceReader} from './recall-availability.mjs';
import {contextMemorySourceState} from './source-state.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const scope={organizationId:'org',ownerUserId:'owner',projectId:'project',workspaceId:'workspace',hostId:'host',environmentId:'env',bindingHash:'binding',bindingEpoch:1,visibility:'private'};
const execution={...scope,runtimeId:'runtime',mode:'runtime',available:true,status:'authorized'};
const content='  exact é\r\npreference  ',done=Date.parse('2026-10-30T12:00:00Z');
const envelope=(id,role,text)=>({info:{id,sessionID:'source-chat',role,time:{created:done-10,...(role==='assistant'?{completed:done}:{})},...(role==='assistant'?{finish:'stop'}:{})},parts:[{id:id+':text',sessionID:'source-chat',messageID:id,type:'text',text}]});
function fixture({assistantOnly=false}={}) {
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 db.exec(`CREATE TABLE context_conversations(id TEXT,project_id TEXT,organization_id TEXT,owner_user_id TEXT,visibility TEXT,metadata TEXT);
 CREATE TABLE context_messages(id TEXT,project_id TEXT,conversation_id TEXT,sequence INTEGER,role TEXT,content TEXT,content_hash TEXT,metadata TEXT,idempotency_key TEXT,created_at TEXT);
 CREATE TABLE context_checkpoints(project_id TEXT,conversation_id TEXT,sequence INTEGER,through_message_id TEXT,message_count INTEGER,idempotency_key TEXT,metadata TEXT,created_at TEXT);`);
 const meta={source:'opencode-chat',sourceRuntimeId:'runtime',sourceSessionId:'source-chat'};
 db.prepare('INSERT INTO context_conversations VALUES (?,?,?,?,?,?)').run('context','project','org','owner','private',JSON.stringify(meta));
 const text=[content,'Acknowledged'];
 for(const [sequence,role]of[[0,'user'],[1,'assistant']])db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('context-'+role,'project','context',sequence,role,text[sequence],hash(text[sequence]),JSON.stringify({...meta,sourceMessageId:'engine-'+role}),`opencode-${role}:${hash(`runtime\0source-chat\0engine-${role}`)}`,new Date(done).toISOString());
 db.prepare('INSERT INTO context_checkpoints VALUES (?,?,?,?,?,?,?,?)').run('project','context',0,'context-assistant',2,`opencode-checkpoint:${hash('runtime\0source-chat\0engine-assistant')}`,JSON.stringify({...meta,sourceAssistantMessageId:'engine-assistant'}),new Date(done).toISOString());
 const key=scopeKey(scope);db.prepare('INSERT INTO veyra_memory_policy VALUES (?,?,?,?,?,?)').run(key,1,1,0,1,0);
 db.prepare('INSERT INTO veyra_memory_chat_policy VALUES (?,?,?,?,?)').run(key,'source-chat',1,1,0);
 const ref={id:assistantOnly?'context-assistant':'context-user',chatId:'source-chat',contentHash:hash(assistantOnly?text[1]:content)};
 const provenance={sources:[ref],model:'past-qualified-model',policyRevision:1,inferred:true};
 function seed(id='memory',time=done){db.prepare('INSERT INTO veyra_memory_recall VALUES (?,?,?,?,?,1,?,?,?)').run(key,id,'Remembered preference',hash('Remembered preference'),JSON.stringify(provenance),'active',new Date(time).toISOString(),new Date(time).toISOString());}
 seed();
 let owner={scope,execution,ownerInstanceId:'actual-container',directory:'/workspace',target:{baseUrl:'http://owned:4098',directory:'/workspace'}},allowed=true,sourceAllowed=true;
 let list=[envelope('engine-user','user',content),envelope('engine-assistant','assistant',text[1])];
 const byId=new Map(list.map(item=>[item.info.id,structuredClone(item)])),calls=[],queries=[];let afterRead=null;
 const options={scope,execution,getDb:()=>db,getOwner:async({chatId})=>{calls.push(['owner',chatId]);return owner;},
  transport:{getSession:async(o,chatId)=>({id:chatId,projectID:'native-project',directory:'/workspace',path:'/workspace',time:{created:done-100,updated:done+1_000_000}}),
   getMessages:async(o,chatId,limit)=>{calls.push(['list',chatId,limit]);return structuredClone(list);},
   getSessionMessage:async(o,chatId,id)=>{calls.push(['message',chatId,id]);const value=structuredClone(byId.get(id)??{error:{code:'NOT_FOUND'}});if(afterRead)afterRead();return value;}}};
 const reader=createRecallSourceReader(options);
 const memory=new MemoryLifecycle({db:{exec:sql=>db.exec(sql),prepare:sql=>{queries.push(sql);return db.prepare(sql);}},authorize:(s,p,chatId)=>allowed&&(p!=='read-source'||sourceAllowed),checkpoint:()=>{},
  sources:(s,chatId,id)=>{const row=db.prepare('SELECT conversation_id,content_hash FROM context_messages WHERE id=?').get(id);if(!row)return null;return {...contextMemorySourceState({db,scope:s,execution,chatId,messageId:id,conversationId:row.conversation_id,contentHash:row.content_hash,readAvailability:reader.view}),contentHash:row.content_hash,kind:'transcript'};}});
 const plan=()=>memory.planSourceReads(scope,'fresh-chat');
 const recall=plan=>reader.withVerifiedSources(()=>memory.withSourceReadPlan(scope,'fresh-chat',plan,()=>memory.recall(scope,'fresh-chat')));
 return {db,key,ref,reader,memory,options,byId,calls,queries,seed,plan,recall,get list(){return list;},set list(value){list=value;},get owner(){return owner;},set owner(value){owner=value;},set allowed(value){allowed=value;},set sourceAllowed(value){sourceAllowed=value;},set afterRead(value){afterRead=value;}};
}

export {fixture,scope,execution,content,done,hash,envelope};
