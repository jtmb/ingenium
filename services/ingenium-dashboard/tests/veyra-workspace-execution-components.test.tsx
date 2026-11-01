import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const state=vi.hoisted(()=>({owner:'11111111-1111-4111-8111-111111111111',org:'22222222-2222-4222-8222-222222222222',params:new URLSearchParams(),request:vi.fn(),projects:vi.fn(),client:vi.fn(),renders:[] as Array<{owner:string;runtime:string|null}>}));
vi.mock('../src/lib/api',()=>({request:state.request,api:{projects:{list:state.projects}}}));
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:state.owner}})}));
vi.mock('../src/lib/OrganizationContext',()=>({useOrganization:()=>({active:{id:state.org}})}));
vi.mock('next/navigation',()=>({useSearchParams:()=>state.params}));
vi.mock('../src/lib/opencode',()=>({createOpenCodeClient:state.client}));
import {ProjectProvider,useOptionalProject} from '../src/lib/ProjectContext';
import {RuntimeProvider,useRuntime} from '../src/lib/RuntimeContext';
import {workConversationNavigation,workLocationMatches} from '../src/app/components/veyra-work/work-navigation';
const runtime='33333333-3333-4333-8333-333333333333';
const row=(owner=state.owner)=>({schemaVersion:2,instanceId:'a'.repeat(32),scopeKind:'workspace',projectId:null,kind:'cluster',ownerUserId:owner,organizationId:state.org,workspaceId:'my-workspace',runtimeId:runtime,label:'My workspace',claimedState:'READY',bindingHash:'b'.repeat(64),bindingEpoch:1});
const confirmation=(owner=state.owner)=>({...row(owner),hostId:'actual-host',environmentId:'managed-workspace-runtime-v2:'+'a'.repeat(32),available:true});
function Probe(){const r=useRuntime(),project=useOptionalProject();state.renders.push({owner:state.owner,runtime:r.client?r.runtimeId:null});return <><p>Legacy project: {project??'none'}</p><p>Execution: {r.client?r.runtimeId:'unconfirmed'}</p><p>Status: {r.workspace.status}</p><button onClick={()=>r.workspace.selectWorkspace('my-workspace')}>Select target</button><button onClick={()=>void r.workspace.start()}>Open target</button></>}
const app=()=> <ProjectProvider projectless><RuntimeProvider projectless><Probe/></RuntimeProvider></ProjectProvider>;
beforeEach(()=>{state.owner='11111111-1111-4111-8111-111111111111';state.params=new URLSearchParams();state.request.mockReset();state.projects.mockReset();state.client.mockReset().mockImplementation(id=>({runtimeId:id}));state.renders=[];sessionStorage.clear();state.request.mockImplementation(async(path:string)=>path.startsWith('/workspace-execution/confirm')?{data:confirmation()}:{data:[row()],pagination:{hasMore:false,cursor:'my-workspace'}})});
afterEach(()=>cleanup());
describe('actual Work provider composition with explicit API doubles',()=>{
 it('does not load the global project or create an agent client before explicit confirmation',async()=>{
  render(app());await screen.findByText('Status: selecting');expect(state.projects).not.toHaveBeenCalled();expect(state.client).not.toHaveBeenCalled();expect(screen.getByText('Legacy project: none')).toBeTruthy();fireEvent.click(screen.getByText('Select target'));fireEvent.click(screen.getByText('Open target'));await screen.findByText('Execution: '+runtime);expect(state.client).toHaveBeenCalledWith(runtime);expect(state.request.mock.calls.some(([path])=>path.startsWith('/runtimes/'))).toBe(false);
 });
 it('canonicalizing the same runtime URL keeps the bound client and does not re-confirm or clear its child state',async()=>{
  const mounted=render(app());await screen.findByText('Status: selecting');fireEvent.click(screen.getByText('Select target'));fireEvent.click(screen.getByText('Open target'));await screen.findByText('Execution: '+runtime);const clientCalls=state.client.mock.calls.length,confirmCalls=state.request.mock.calls.filter(([path])=>path.startsWith('/workspace-execution/confirm')).length;state.params=new URLSearchParams({runtime,session:'engine-session'});mounted.rerender(app());expect(screen.getByText('Execution: '+runtime)).toBeTruthy();expect(state.client.mock.calls.length).toBe(clientCalls);expect(state.request.mock.calls.filter(([path])=>path.startsWith('/workspace-execution/confirm')).length).toBe(confirmCalls);
 });
 it('removes the old actor client in the first render after identity changes, before a new response',async()=>{
  state.params=new URLSearchParams({runtime});const mounted=render(app());await screen.findByText('Execution: '+runtime);state.owner='44444444-4444-4444-8444-444444444444';state.request.mockImplementation(()=>new Promise(()=>{}));mounted.rerender(app());expect(screen.getByText('Execution: unconfirmed')).toBeTruthy();expect(state.renders.filter(r=>r.owner===state.owner).every(r=>r.runtime===null)).toBe(true);
 });
 it('never uses a listed READY value when fresh confirmation fails',async()=>{
  state.params=new URLSearchParams({runtime});state.request.mockImplementation(async(path:string)=>{if(path.startsWith('/workspace-execution/confirm'))throw Error('manager unavailable');return {data:[row()],pagination:{hasMore:false,cursor:'my-workspace'}}});render(app());await screen.findByText('Status: error');expect(state.client).not.toHaveBeenCalled();expect(screen.getByText('Execution: unconfirmed')).toBeTruthy();
 });
});
it('projectless conversation navigation removes a legacy Project selector and preserves other URL state',()=>{
 const next=workConversationNavigation({search:'project=old-global&tab=files&session=before',hash:'#activity',sessionId:'engine-session',runtimeId:runtime,project:null,intent:'select'});const url=new URL(next.href,'http://test');expect(url.searchParams.has('project')).toBe(false);expect(url.searchParams.get('tab')).toBe('files');expect(url.hash).toBe('#activity');expect(workLocationMatches(url.search,{sessionId:'engine-session',runtimeId:runtime,project:null})).toBe(true);expect(workLocationMatches('session=engine-session&project=old-global',{sessionId:'engine-session',runtimeId:runtime,project:null})).toBe(false);
});
