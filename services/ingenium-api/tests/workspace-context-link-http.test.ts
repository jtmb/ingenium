import {beforeAll,afterAll,beforeEach,expect,it,vi} from 'vitest';
import express from 'express';
import {createServer,type Server} from 'node:http';
import {closeHttpServer,listenOnLoopback} from './http-fixtures.js';
// Real Express/request routing with unit ownership ports. Original placement,
// SQLite authentication, engine creation and runtime/image remain separate gates.
const h=vi.hoisted(()=>({runtime:null as any,find:vi.fn(),placement:vi.fn(),legacyProject:vi.fn(),legacyCreate:vi.fn(),execution:null as any,persist:vi.fn()}));
vi.mock('ingenium-core',()=>({authorization:{},context:{},contextRag:{},getDb:vi.fn(()=>{throw Error('No DB may open in this router unit test')}),runtimes:{getWorkspaceRuntimeV2:()=>h.runtime},contextConversations:{createContextConversation:(...args:any[])=>h.legacyCreate(...args)}}));
vi.mock('../lib/helpers.js',()=>({requestAuthorizationPrincipal:vi.fn(),requestContentActor:vi.fn(),requireContentAccess:vi.fn(),requireProject:(req:any,res:any)=>h.legacyProject(req,res)}));
vi.mock('../lib/opencode-client.js',()=>({executeSynthesisBroker:vi.fn()}));
vi.mock('../lib/runtime-mode.js',()=>({deploymentMode:()=> 'control-plane'}));
vi.mock('../lib/projects-v2/projectless-context.mjs',()=>({findWorkspaceEngineContext:(...args:any[])=>h.find(...args),persistOriginalWorkspaceEngineTurn:(...args:any[])=>h.persist(...args)}));
vi.mock('../lib/projects-v2/workspace-v2-placement.mjs',()=>({withManagedWorkspaceV2Placement:(...args:any[])=>h.placement(...args)}));
import {contextRouter} from '../lib/routes/context.js';
let server:Server,origin:string;
beforeAll(async()=>{const app=express();app.use(express.json());app.use('/api/v1/context',contextRouter);server=createServer(app);origin=await listenOnLoopback(server)});
afterAll(async()=>{await closeHttpServer(server)});
beforeEach(()=>{
 vi.clearAllMocks();h.runtime={id:'original-runtime',workspaceId:'owned-workspace',projectId:null};
 h.persist.mockResolvedValue({revision:2,idempotent:false});
 h.find.mockReturnValue({conversation:{id:'distinct-context',project_id:null,title:'Original title',revision:4},mapping:{engineSessionId:'original-engine'}});
 h.placement.mockImplementation(async(_req:any,selection:any,work:()=>unknown)=>{expect(selection).toEqual({projectId:null,workspaceId:'owned-workspace',runtimeId:'original-runtime'});return work()});
 h.legacyProject.mockImplementation((_req:any,res:any)=>{res.status(422).json({error:{code:'LEGACY_PROJECT_REQUIRED'}});return null});
});
async function link(body:Record<string,unknown>){const response=await fetch(origin+'/api/v1/context/chat-sessions/link',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {response,body:await response.json() as any};}
it('hydrates only the original source mapping and preserves its canonical ID, revision and title',async()=>{
 const {response,body}=await link({runtimeId:'original-runtime',sessionId:'original-engine',title:'Browser title'});
 expect(response.status).toBe(201);expect(response.headers.get('cache-control')).toBe('no-store');expect(body.data).toEqual({id:'distinct-context',project_id:null,title:'Original title',revision:4});expect(h.find.mock.calls[0]!.slice(1)).toEqual([{projectId:null,workspaceId:'owned-workspace',runtimeId:'original-runtime'},'original-engine']);expect(h.legacyProject).not.toHaveBeenCalled();expect(h.legacyCreate).not.toHaveBeenCalled();
});
for(const [code,status]of [['WORKSPACE_ENGINE_MAPPING_UNAVAILABLE',404],['INVALID_WORKSPACE_CONTEXT_INPUT',422],['WORKSPACE_V2_ORIGINAL_PLACEMENT_UNAVAILABLE',503]] as const)it('does not mint or fall back when original ownership is unavailable: '+code,async()=>{
 h.find.mockImplementation(()=>{throw Object.assign(Error('private details must not escape'),{code})});const {response,body}=await link({runtimeId:'original-runtime',sessionId:'untrusted-engine'});
 expect(response.status).toBe(status);expect(body.error.code).toBe('WORKSPACE_CHAT_LINK_UNAVAILABLE');expect(JSON.stringify(body)).not.toContain('private details');expect(h.legacyProject).not.toHaveBeenCalled();expect(h.legacyCreate).not.toHaveBeenCalled();
});
it('denies before reading private Context when the actual placement owner refuses',async()=>{
 h.placement.mockRejectedValue(Error('Unauthorized private identity'));const {response}=await link({runtimeId:'original-runtime',sessionId:'original-engine'});
 expect(response.status).toBe(503);expect(h.find).not.toHaveBeenCalled();expect(h.legacyProject).not.toHaveBeenCalled();expect(h.legacyCreate).not.toHaveBeenCalled();
});
it('preserves the existing Project path for an actual non-v2 runtime',async()=>{
 h.runtime=undefined;const {response,body}=await link({runtimeId:'legacy-runtime',sessionId:'legacy-engine'});
 expect(response.status).toBe(422);expect(body.error.code).toBe('LEGACY_PROJECT_REQUIRED');expect(h.legacyProject).toHaveBeenCalledTimes(1);expect(h.find).not.toHaveBeenCalled();expect(h.placement).not.toHaveBeenCalled();
});

async function persistTurn(body:Record<string,unknown>){const response=await fetch(origin+'/api/v1/context/conversations/distinct-context/chat-turns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {response,body:await response.json() as any};}
it('the selected original-turn route passes only IDs/revision to the server-owned reader',async()=>{
 const {response}=await persistTurn({runtimeId:'original-runtime',sessionId:'engine',userMessageId:'user',assistantMessageId:'assistant',expectedRevision:0,userContent:'forged user',assistantContent:'forged assistant'});expect(response.status).toBe(201);expect(h.persist.mock.calls[0]!.slice(1)).toEqual([{projectId:null,workspaceId:'owned-workspace',runtimeId:'original-runtime'},'distinct-context',{sessionId:'engine',userMessageId:'user',assistantMessageId:'assistant',expectedRevision:0}]);expect(h.legacyProject).not.toHaveBeenCalled();
});
it('canonical revision conflicts retain the existing browser refresh contract',async()=>{
 h.persist.mockRejectedValue(Object.assign(Error('private details'),{code:'WORKSPACE_CONTEXT_REVISION_CONFLICT'}));const {response,body}=await persistTurn({runtimeId:'original-runtime'});expect(response.status).toBe(409);expect(body.error.code).toBe('REVISION_CONFLICT');expect(JSON.stringify(body)).not.toContain('private details');expect(h.legacyProject).not.toHaveBeenCalled();
});
it('a refused original turn cannot fall through into Project transcript ingestion',async()=>{
 h.persist.mockRejectedValue(Error('unavailable original owner'));const {response}=await persistTurn({runtimeId:'original-runtime',userContent:'invented'});expect(response.status).toBe(503);expect(h.legacyProject).not.toHaveBeenCalled();expect(h.legacyCreate).not.toHaveBeenCalled();
});
it('the real legacy Project parameter policy remains in force for a non-v2 turn',async()=>{
 h.runtime=undefined;const {response,body}=await persistTurn({runtimeId:'legacy-runtime'});expect(response.status).toBe(422);expect(body.error.code).toBe('LEGACY_PROJECT_REQUIRED');expect(h.legacyProject).toHaveBeenCalledTimes(1);expect(h.persist).not.toHaveBeenCalled();
});
