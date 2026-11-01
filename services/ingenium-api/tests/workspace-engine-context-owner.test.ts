import {beforeEach,expect,it,vi} from 'vitest';
// Source orchestration controls with explicit unit ports. This is not an
// authenticated SQLite/physical runtime qualification or production producer proof.
const h=vi.hoisted(()=>({db:null as any,execution:null as any,runtime:null as any,identity:null as any,target:null as any,created:null as any,create:vi.fn(),link:vi.fn(),checkpoint:vi.fn(),writes:[] as any[],txCalls:0,page:vi.fn(),persist:vi.fn(),mapping:null as any}));
vi.mock('ingenium-core',()=>({getDb:()=>h.db,checkpointAfterWrite:()=>h.checkpoint(),sanitizeFts5Query:(v:string)=>v,runtimes:{getWorkspaceRuntimeV2:()=>h.runtime},workspaceRuntimeCredentialsV2:{workspaceRuntimeOpenCodeAuthV2:()=> 'original-unit-secret'},workspaceContext:{assertWorkspaceStoreScope:()=>({revision:1,backend_container_id:'container'}),linkOriginalEngineInTransaction:(db:any,scope:any,input:any)=>h.link(db,scope,input),resolveEngineMapping:()=>h.mapping,persistOriginalEngineTurnInTransaction:(...args:any[])=>h.persist(...args)}}));
vi.mock('../lib/request-identity.js',()=>({revalidateRequestIdentity:()=>h.identity}));
vi.mock('../lib/projects-v2/workspace-v2-placement.mjs',()=>({resolveCurrentWorkspaceV2Execution:()=>h.execution,withManagedWorkspaceV2Placement:async(_req:any,_selection:any,work:()=>unknown)=>{expect(h.db.inTransaction).toBe(false);return work()}}));
vi.mock('../lib/opencode-client.js',()=>({opencodeClient:{createSession:(...args:any[])=>h.create(...args),getMessagesPage:(...args:any[])=>h.page(...args)},isOpenCodeError:(v:any)=>Boolean(v?.error)}));
vi.mock('../lib/runtime-opencode-context.js',()=>({currentOpenCodeRuntimeTarget:()=>h.target,withOpenCodeRuntimeTarget:(target:any,work:()=>unknown)=>{expect(target).toEqual(h.target);return work()}}));
import {createOriginalWorkspaceEngineSession,workspaceEngineSelection,persistOriginalWorkspaceEngineTurn,getWorkspaceExecutionV2,createWorkspaceContext} from '../lib/projects-v2/projectless-context.mjs';
const selection={projectId:null,workspaceId:'workspace',runtimeId:'runtime'} as const;
beforeEach(()=>{
 vi.clearAllMocks();h.txCalls=0;h.writes=[];
 h.execution={...selection,organizationId:'org',ownerUserId:'owner',bindingHash:'a'.repeat(64),bindingEpoch:1,status:'authorized',mode:'runtime',hostId:'host',environmentId:'environment',available:true};
 h.runtime={id:'runtime',workspaceId:'workspace',backendName:'original-runtime'};
 h.identity={principal:{type:'user',id:'owner',session:{id:'session',security_epoch:1}}};
 h.target={baseUrl:'http://original-runtime:4098',directory:'/workspace',authHeader:'original-unit-secret'};
 h.created={id:'original-engine',title:'Original title',directory:'/workspace'};
 h.mapping={contextConversationId:'distinct-context',engineSessionId:'original-engine',runtimeId:'runtime',executionGeneration:'b'.repeat(64),purpose:'active'};
 h.db={
  inTransaction:false,
  prepare:(sql:string)=>({get:()=>sql.includes('runtime_original_provisions')?{start_identity:'b'.repeat(64)}:{present:1}}),
  transaction:(callback:()=>unknown)=>({immediate:()=>{
   h.txCalls++;h.db.inTransaction=true;const before=h.writes.length;
   try{return callback()}catch(e){h.writes.length=before;throw e}finally{h.db.inTransaction=false}
  }})
 };
 h.link.mockImplementation((db:any,scope:any,input:any)=>{expect(db).toBe(h.db);expect(db.inTransaction).toBe(true);expect(scope.projectId).toBeNull();expect(scope.executionGeneration).toBe('b'.repeat(64));h.writes.push(input);return {conversation:{id:'distinct-context'},idempotent:false}});
 h.create.mockImplementation(async()=>{expect(h.db.inTransaction).toBe(false);expect(h.writes).toHaveLength(0);return h.created});
 h.page.mockResolvedValue({messages:[message('user-message','user','  original user\n'),message('assistant-message','assistant','original assistant\n')]});
 h.persist.mockImplementation((db:any,_scope:any,id:any,input:any)=>{expect(db.inTransaction).toBe(true);expect(id).toBe('distinct-context');h.writes.push(input);return {revision:2,idempotent:false}});
});
it('only the owner of the original HTTP creation links the distinct canonical Context in the original writer',async()=>{
 const result=await createOriginalWorkspaceEngineSession({} as never,selection,{title:'Requested'});
 expect(h.create).toHaveBeenCalledExactlyOnceWith({title:'Requested'},'/workspace');expect(h.link).toHaveBeenCalledTimes(1);expect(h.writes).toEqual([{engineSessionId:'original-engine',title:'Original title'}]);expect(result).toMatchObject({id:'original-engine',contextConversationId:'distinct-context'});expect(h.checkpoint).toHaveBeenCalledTimes(1);expect(h.db.inTransaction).toBe(false);
});
for(const changed of [{baseUrl:'http://foreign:4098'},{directory:'/elsewhere'},{authHeader:'foreign-secret'}])it('refuses target drift before upstream HTTP: '+Object.keys(changed)[0],async()=>{
 Object.assign(h.target,changed);await expect(createOriginalWorkspaceEngineSession({} as never,selection,{})).rejects.toThrow('WORKSPACE_ORIGINAL_ENGINE_TARGET_UNAVAILABLE');expect(h.create).not.toHaveBeenCalled();expect(h.link).not.toHaveBeenCalled();
});
it('refuses nested canonical transactions before upstream HTTP',async()=>{
 h.db.inTransaction=true;await expect(createOriginalWorkspaceEngineSession({} as never,selection,{})).rejects.toThrow('WORKSPACE_CONTEXT_NESTED_TRANSACTION_UNAVAILABLE');expect(h.create).not.toHaveBeenCalled();
});
for(const input of [{engineSessionId:'browser-invented'},{metadata:{sourceSessionId:'browser-invented'}},{title:''},{title:'x'.repeat(257)}])it('rejects caller-owned response or invalid creation input: '+JSON.stringify(input).slice(0,45),async()=>{
 await expect(createOriginalWorkspaceEngineSession({} as never,selection,input as never)).rejects.toThrow('INVALID_WORKSPACE_CONTEXT_INPUT');expect(h.create).not.toHaveBeenCalled();expect(h.link).not.toHaveBeenCalled();
});
it('unknown upstream creation is not converted to a safe-to-retry failure or a fabricated Context',async()=>{
 h.create.mockResolvedValue({error:{code:'NETWORK_ERROR'}});const result=await createOriginalWorkspaceEngineSession({} as never,selection,{});
 expect(result).toMatchObject({error:{code:'WORKSPACE_ENGINE_CREATION_UNCONFIRMED'}});expect(h.create).toHaveBeenCalledTimes(1);expect(h.link).not.toHaveBeenCalled();expect(h.txCalls).toBe(0);
});
for(const [name,change] of [['actor',()=>{h.identity.principal.id='foreign'}],['epoch',()=>{h.execution.bindingEpoch++}],['target',()=>{h.target.authHeader='rotated'}]])it('post-dispatch '+name+' drift preserves uncertainty and performs no Context write',async()=>{
 h.create.mockImplementation(async()=>{change();return h.created});const result=await createOriginalWorkspaceEngineSession({} as never,selection,{});
 expect(result).toMatchObject({error:{code:'WORKSPACE_ENGINE_CONTEXT_UNCONFIRMED'}});expect(h.link).not.toHaveBeenCalled();expect(h.create).toHaveBeenCalledTimes(1);expect(h.checkpoint).not.toHaveBeenCalled();
});
it('a transactional link failure rolls back and never reissues the original HTTP creation',async()=>{
 h.link.mockImplementation(()=>{h.writes.push('partial');throw Error('synthetic write failure')});const result=await createOriginalWorkspaceEngineSession({} as never,selection,{});
 expect(result).toMatchObject({error:{code:'WORKSPACE_ENGINE_CONTEXT_UNCONFIRMED'}});expect(h.create).toHaveBeenCalledTimes(1);expect(h.writes).toEqual([]);expect(h.db.inTransaction).toBe(false);expect(h.checkpoint).not.toHaveBeenCalled();
});
it('workspace selection reads only actual runtime ownership and does not create a grant',()=>{
 const request={get:()=> 'runtime',query:{}};expect(workspaceEngineSelection(request as never)).toEqual(selection);
 h.runtime=null;expect(workspaceEngineSelection(request as never)).toBeNull();expect(workspaceEngineSelection({get:()=>undefined,query:{}} as never)).toBeNull();expect(h.create).not.toHaveBeenCalled();expect(h.link).not.toHaveBeenCalled();
});

function message(id:string,role:'user'|'assistant',text:string){return {info:{id,role,sessionID:'original-engine',time:{created:1,...(role==='assistant'?{completed:2}:{})},...(role==='assistant'?{finish:'stop'}:{})},parts:[{id:'part-'+id,type:'text',messageID:id,sessionID:'original-engine',text}]};}
const turn={sessionId:'original-engine',userMessageId:'user-message',assistantMessageId:'assistant-message',expectedRevision:0};
it('reads actual scoped engine message bytes; browser text cannot become Context content',async()=>{
 const result=await persistOriginalWorkspaceEngineTurn({} as never,selection,'distinct-context',turn);
 expect(result.revision).toBe(2);expect(h.page).toHaveBeenCalledExactlyOnceWith('original-engine',100,undefined,'/workspace');expect(h.writes).toEqual([{engineSessionId:'original-engine',userMessageId:'user-message',assistantMessageId:'assistant-message',userContent:'  original user\n',assistantContent:'original assistant\n',expectedRevision:0}]);expect(h.checkpoint).toHaveBeenCalledTimes(1);
});
it('rejects a caller-supplied transcript before any engine request or Context write',async()=>{
 await expect(persistOriginalWorkspaceEngineTurn({} as never,selection,'distinct-context',{...turn,userContent:'forged'} as never)).rejects.toThrow('INVALID_WORKSPACE_CONTEXT_INPUT');expect(h.page).not.toHaveBeenCalled();expect(h.persist).not.toHaveBeenCalled();
});
it('follows actual pagination without accepting an invented message or cursor',async()=>{
 h.page.mockResolvedValueOnce({messages:[message('user-message','user','page-one')],nextCursor:'original-cursor'}).mockResolvedValueOnce({messages:[message('assistant-message','assistant','page-two')]});await persistOriginalWorkspaceEngineTurn({} as never,selection,'distinct-context',turn);expect(h.page.mock.calls[1]).toEqual(['original-engine',100,'original-cursor','/workspace']);expect(h.writes[0].userContent).toBe('page-one');expect(h.writes[0].assistantContent).toBe('page-two');
});
for(const [name,mutate]of [['incomplete',(m:any)=>{delete m.info.time.completed}],['failed',(m:any)=>{m.info.finish='error'}],['foreign part',(m:any)=>{m.parts[0].sessionID='foreign'}],['wrong assistant role',(m:any)=>{m.info.role='user'}],['empty text',(m:any)=>{m.parts[0].text=''}]])it('does not save an unverifiable original message: '+name,async()=>{
 const assistant=message('assistant-message','assistant','response');mutate(assistant);h.page.mockResolvedValue({messages:[message('user-message','user','user'),assistant]});await expect(persistOriginalWorkspaceEngineTurn({} as never,selection,'distinct-context',turn)).rejects.toThrow();expect(h.persist).not.toHaveBeenCalled();expect(h.writes).toEqual([]);
});
it('refuses a requested user ID that is not the preceding original user in source order',async()=>{
 h.page.mockResolvedValue({messages:[message('user-message','user','one'),message('other-user','user','two'),message('assistant-message','assistant','answer')]});await expect(persistOriginalWorkspaceEngineTurn({} as never,selection,'distinct-context',turn)).rejects.toThrow('WORKSPACE_ORIGINAL_COMPLETED_TURN_UNAVAILABLE');expect(h.persist).not.toHaveBeenCalled();
});
it('stops a looping actual cursor without a partial Context write',async()=>{
 h.page.mockResolvedValue({messages:[],nextCursor:'repeated'});await expect(persistOriginalWorkspaceEngineTurn({} as never,selection,'distinct-context',turn)).rejects.toThrow('WORKSPACE_ORIGINAL_MESSAGE_CURSOR_UNAVAILABLE');expect(h.page).toHaveBeenCalledTimes(2);expect(h.persist).not.toHaveBeenCalled();
});
it('revalidates identity after original engine reads before opening the write transaction',async()=>{
 h.page.mockImplementation(async()=>{h.identity.principal.id='foreign';return {messages:[message('user-message','user','user'),message('assistant-message','assistant','answer')]}});await expect(persistOriginalWorkspaceEngineTurn({} as never,selection,'distinct-context',turn)).rejects.toThrow();expect(h.persist).not.toHaveBeenCalled();expect(h.txCalls).toBe(0);
});
it('an engine read failure never falls back to browser content or fabricates a checkpoint',async()=>{
 h.page.mockResolvedValue({error:{code:'NETWORK_ERROR'}});await expect(persistOriginalWorkspaceEngineTurn({} as never,selection,'distinct-context',turn)).rejects.toThrow('WORKSPACE_ORIGINAL_MESSAGE_UNAVAILABLE');expect(h.persist).not.toHaveBeenCalled();expect(h.checkpoint).not.toHaveBeenCalled();
});

it('read-only Context binding may join the same existing canonical writer transaction',()=>{
 h.db.inTransaction=true;const scope=getWorkspaceExecutionV2({} as never,selection);expect(scope.projectId).toBeNull();expect(scope.executionGeneration).toBe('b'.repeat(64));expect(h.txCalls).toBe(0);expect(h.writes).toEqual([]);expect(h.checkpoint).not.toHaveBeenCalled();
});
it('joining a canonical transaction never permits another Context mutation or engine request',()=>{
 h.db.inTransaction=true;expect(()=>createWorkspaceContext({} as never,selection,{title:'Never written'})).toThrow('WORKSPACE_CONTEXT_NESTED_TRANSACTION_UNAVAILABLE');expect(h.create).not.toHaveBeenCalled();expect(h.txCalls).toBe(0);expect(h.writes).toEqual([]);
});
