import {beforeEach,expect,it,vi}from'vitest';
import{createHash}from'node:crypto';
import{scopeKey,MemoryError}from'../lib/memory-v2/lifecycle.mjs';
// Binding transformation tests with explicit original owner ports; not actual
// authenticated HTTP, placement or physical runtime qualification.
const h=vi.hoisted(()=>({workspace:null as any,legacy:null as any,identity:null as any,scope:null as any,execution:null as any,org:vi.fn(),project:vi.fn(),getV2:vi.fn(),session:vi.fn(),placement:vi.fn()}));
vi.mock('ingenium-core',()=>({authorization:{requireOrganizationPermission:(...args:any[])=>h.org(...args),requireProjectPermission:(...args:any[])=>h.project(...args)},runtimes:{getAuthorizedWorkspace:()=>h.legacy,getAuthorizedWorkspaceV2:(...args:any[])=>h.getV2(...args)}}));
vi.mock('../lib/request-identity.js',()=>({revalidateRequestIdentity:()=>h.identity}));
vi.mock('../lib/authorization-policy.js',()=>({toAuthorizationPrincipal:(p:any)=>({type:'browser-user',id:p.id,scopes:p.scopes})}));
vi.mock('../lib/projects-v2/request-execution.js',()=>({resolveRequestExecution:()=>h.execution,resolveRequestChatBinding:()=>({contextConversationId:'distinct-context'})}));
import{readWorkMemoryBinding}from'../lib/memory-v2/work-binding.js';
beforeEach(()=>{
 vi.clearAllMocks();h.legacy=undefined;h.workspace={id:'workspace',projectId:null,organizationId:'org',ownerUserId:'owner',status:'authorized',schemaVersion:2};h.getV2.mockImplementation(()=>h.workspace);
 h.identity={principal:{type:'user',id:'owner',session:{id:'session',security_epoch:1},scopes:['user:*']}};
 h.scope={organizationId:'org',ownerUserId:'owner',projectId:null,workspaceId:'workspace',hostId:'host',environmentId:'environment',bindingHash:'b'.repeat(64),bindingEpoch:2,visibility:'private'};h.execution={...h.scope,runtimeId:'runtime',available:true,mode:'runtime',status:'authorized'};
 h.org.mockReturnValue({allowed:true});h.project.mockReturnValue({allowed:true});h.session.mockReturnValue({resolveScope:()=>h.scope,memory:{policy:()=>({scopeHash:createHash('sha256').update(scopeKey(h.scope)).digest('hex')})}});h.placement.mockImplementation(async(_r:any,_s:any,work:()=>unknown)=>work());
});
const request=(extra={})=>({query:{workspaceId:'workspace',runtimeId:'runtime',engineSessionId:'engine',...extra}} as never);
const read=(extra={})=>readWorkMemoryBinding(request(extra),{createSession:h.session as never,withPlacement:h.placement as never});
it('profile2 derives actual null scope from the schema2 workspace and original owner',async()=>{
 const b=await read();expect(b).toMatchObject({schemaVersion:2,projectId:null,workspaceId:'workspace',runtimeId:'runtime',engineSessionId:'engine',contextConversationId:'distinct-context',canChange:true,canForget:true});expect(h.placement.mock.calls[0]![1]).toEqual({projectId:null,workspaceId:'workspace',runtimeId:'runtime'});expect(h.org).toHaveBeenCalledTimes(1);expect(h.project).not.toHaveBeenCalled();
});
it('expected projectless only narrows original ownership and does not select a global Project',async()=>{
 expect((await read({expectedProjectless:'true'})).projectId).toBeNull();await expect(read({expectedProjectId:'invented'})).rejects.toMatchObject({code:'BINDING_CHANGED'});expect(h.project).not.toHaveBeenCalled();
});
it('legacy Project profile1 and its original permission owner remain unchanged',async()=>{
 h.legacy={...h.workspace,schemaVersion:1,projectId:'actual-project'};h.scope.projectId='actual-project';h.execution.projectId='actual-project';const b=await read({expectedProjectId:'actual-project'});expect(b.schemaVersion).toBe(1);expect(b.projectId).toBe('actual-project');expect(h.project).toHaveBeenCalledTimes(1);expect(h.org).not.toHaveBeenCalled();expect(h.getV2).not.toHaveBeenCalled();
 await expect(read({expectedProjectless:'true'})).rejects.toMatchObject({code:'BINDING_CHANGED'});
});
it('malformed or contradictory expectations refuse before original placement',async()=>{
 for(const extra of [{expectedProjectless:'false'},{expectedProjectless:'true',expectedProjectId:'project'},{expectedProjectless:null}])await expect(read(extra)).rejects.toMatchObject({code:'INVALID_INPUT'});expect(h.placement).not.toHaveBeenCalled();
});
it('legacy null metadata and another owner cannot acquire the projectless profile',async()=>{
 h.workspace.schemaVersion=1;await expect(read()).rejects.toMatchObject({code:'MEMORY_ADAPTER_UNAVAILABLE'});h.workspace.schemaVersion=2;h.workspace.ownerUserId='other';await expect(read()).rejects.toMatchObject({code:'FORBIDDEN'});expect(h.placement).not.toHaveBeenCalled();
});
it('organization denial remains a disabled mutation capability, never a GET write probe',async()=>{
 h.org.mockReturnValue({allowed:false});const b=await read();expect(b.canChange).toBe(false);expect(b.canForget).toBe(false);
});
