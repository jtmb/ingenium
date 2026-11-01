import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const mocks=vi.hoisted(()=>({request:vi.fn(),push:vi.fn(),owner:'00000000-0000-4000-8000-000000000001',organization:'00000000-0000-4000-8000-000000000002'}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push})}));
vi.mock('../src/lib/api',()=>({request:mocks.request}));
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:mocks.owner}})}));
vi.mock('../src/lib/OrganizationContext',()=>({useOrganization:()=>({active:{id:mocks.organization}})}));
import HostedWorkspaceProjects from '../src/app/components/projects-v2/HostedWorkspaceProjects';
function project(owner=mocks.owner){return {version:1,id:'00000000-0000-4000-8000-000000000003',scope:{ownerUserId:owner,organizationId:mocks.organization,instanceId:'a'.repeat(32)},label:owner.endsWith('1')?'Owned folder':'Other owned folder',revision:1,archived:false,archivedAt:null,pinned:false,roots:[{id:'root',canonicalRootId:'root-identity',hostId:'host',environmentId:'environment',displayPath:'/qualified/folder',isPrimary:true,repositoryIdentity:null}],source:{system:'ingenium',instanceId:'a'.repeat(32),revision:1}}}
const page=(rows:ReturnType<typeof project>[])=>({data:rows,pagination:{hasMore:false,cursor:rows.at(-1)?.id??''}});
beforeEach(()=>{mocks.owner='00000000-0000-4000-8000-000000000001';mocks.request.mockReset();mocks.push.mockReset()});
afterEach(cleanup);
describe('current actor workspace projects in Work',()=>{
 it('renames pins archives and restores through exact original revisioned commands',async()=>{
  let actual=project();const writes:{expectedRevision:number;patch:Record<string,unknown>}[]=[];
  mocks.request.mockImplementation(async(path:string,init?:RequestInit)=>{
   if(init?.method==='PATCH'){const body=JSON.parse(String(init.body));writes.push(body);expect(body.expectedRevision).toBe(actual.revision);actual={...actual,...body.patch,revision:actual.revision+1,archivedAt:body.patch.archived===undefined?actual.archivedAt:body.patch.archived?'2026-10-31T00:00:00Z':null,source:{...actual.source,revision:actual.revision+1}};return {data:actual}}
   return page(new URL(path,'https://fixture.invalid').searchParams.get('archived')===String(actual.archived)?[actual]:[]);
  });
  render(<HostedWorkspaceProjects/>);fireEvent.click(await screen.findByRole('button',{name:'Project settings for Owned folder'}));
  fireEvent.change(screen.getByLabelText('Project name'),{target:{value:'Renamed folder'}});fireEvent.click(screen.getByRole('button',{name:'Rename project'}));
  await waitFor(()=>expect(writes.length).toBe(1));await screen.findByRole('heading',{name:'Renamed folder'});
  fireEvent.click(screen.getByRole('button',{name:'Pin project'}));await screen.findByRole('button',{name:'Unpin project'});
  fireEvent.click(screen.getByRole('button',{name:'Archive project'}));await screen.findByRole('button',{name:'Restore project'});
  fireEvent.click(screen.getByRole('button',{name:'Restore project'}));await screen.findByRole('button',{name:'Archive project'});
  expect(writes.map(x=>x.expectedRevision)).toEqual([1,2,3,4]);expect(writes.map(x=>x.patch)).toEqual([{label:'Renamed folder'},{pinned:true},{archived:true},{archived:false}]);
  expect(screen.getByText('/qualified/folder · Primary')).toBeTruthy();expect(mocks.request.mock.calls.every(([path])=>String(path).startsWith('/workspace-projects'))).toBe(true);
 });
 it('lost response blocks another write until a scoped status read succeeds',async()=>{
  let reads=0,writes=0;const actual=project();
  mocks.request.mockImplementation(async(path:string,init?:RequestInit)=>{if(init){writes++;throw Error('lost response')}if(path.includes('/'+actual.id+'?')){reads++;return {data:actual}}return page([actual])});
  render(<HostedWorkspaceProjects/>);fireEvent.click(await screen.findByRole('button',{name:'Project settings for Owned folder'}));fireEvent.click(screen.getByRole('button',{name:'Pin project'}));
  await screen.findByRole('alert');expect((screen.getByRole('button',{name:'Pin project'}) as HTMLButtonElement).disabled).toBe(true);expect(writes).toBe(1);
  fireEvent.click(screen.getByRole('button',{name:'Refresh selected project'}));await waitFor(()=>expect(reads).toBe(1));await waitFor(()=>expect((screen.getByRole('button',{name:'Pin project'}) as HTMLButtonElement).disabled).toBe(false));expect(writes).toBe(1);
 });
 it('changing actors discards the old pending catalog response',async()=>{
  let finish!:(value:unknown)=>void;const original=project();mocks.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  const view=render(<HostedWorkspaceProjects/>);mocks.owner='00000000-0000-4000-8000-000000000009';const current=project();mocks.request.mockResolvedValue(page([current]));view.rerender(<HostedWorkspaceProjects/>);
  await screen.findByRole('button',{name:'Other owned folder'});finish(page([original]));await waitFor(()=>expect(screen.queryByRole('button',{name:'Owned folder'})).toBeNull());
 });
});

describe('project folder execution and chat grouping',()=>{
 function bound(){const actual=project();actual.roots[0].canonicalRootId='workspace-v2:root:'+('b'.repeat(64));const option={schemaVersion:2,instanceId:actual.scope.instanceId,scopeKind:'workspace',projectId:null,kind:'cluster',ownerUserId:mocks.owner,organizationId:mocks.organization,workspaceId:'root',runtimeId:'00000000-0000-4000-8000-000000000004',label:'Owned folder',claimedState:'READY',bindingHash:'b'.repeat(64),bindingEpoch:0};const execution={...option,available:true as const,hostId:'host',environmentId:'environment'};return {actual,option,execution};}
 it('opens only the freshly confirmed original root and never provisions implicitly',async()=>{
  const {actual,option,execution}=bound();mocks.request.mockImplementation(async(path:string,init?:RequestInit)=>path.startsWith('/workspace-projects')?page([actual]):path.includes('/confirm')?{data:execution}:{data:[option],pagination:{hasMore:false,cursor:'root'}});
  render(<HostedWorkspaceProjects/>);fireEvent.click(await screen.findByRole('button',{name:'Owned folder'}));
  await waitFor(()=>expect(mocks.push).toHaveBeenCalledWith('/work?runtime='+option.runtimeId));
  expect(mocks.request.mock.calls.filter(([,init])=>init?.method==='POST').length).toBe(0);expect(mocks.request.mock.calls.filter(([path])=>String(path).includes('/confirm')).length).toBe(1);expect(mocks.request.mock.calls.every(([path])=>!String(path).includes('provision'))).toBe(true);
 });
 it('groups actual current workspace chats and hides them immediately after a host change',async()=>{
  const {actual,execution}=bound();mocks.request.mockResolvedValue(page([actual]));const select=vi.fn(),caption=vi.fn();
  const view=render(<HostedWorkspaceProjects execution={execution as never} conversations={[{id:'source-session',title:'Actual workspace chat'}]} activeId="source-session" onSelect={select} onMatchingProject={caption}/>);
  const chat=await screen.findByRole('button',{name:'Actual workspace chat'});expect(chat.getAttribute('aria-current')).toBe('page');fireEvent.click(chat);expect(select).toHaveBeenCalledWith('source-session');fireEvent.click(screen.getByRole('button',{name:'Toggle chats for Owned folder'}));expect(screen.queryByRole('button',{name:'Actual workspace chat'})).toBeNull();expect(mocks.push).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Toggle chats for Owned folder'}));expect(screen.getByRole('button',{name:'Actual workspace chat'})).toBeTruthy();await waitFor(()=>expect(caption).toHaveBeenLastCalledWith({executionKey:JSON.stringify(execution),label:actual.label}));
  view.rerender(<HostedWorkspaceProjects execution={{...execution,hostId:'other-host'} as never} conversations={[{id:'source-session',title:'Actual workspace chat'}]} onSelect={select} onMatchingProject={caption}/>);expect(screen.queryByRole('button',{name:'Actual workspace chat'})).toBeNull();await waitFor(()=>expect(caption.mock.calls.at(-1)?.[0].label).toBeNull());
 });
 it('refuses a changed folder binding without navigation or a start request',async()=>{
  const {actual,option,execution}=bound();mocks.request.mockImplementation(async(path:string)=>path.startsWith('/workspace-projects')?page([actual]):path.includes('/confirm')?{data:{...execution,hostId:'other-host'}}:{data:[option],pagination:{hasMore:false,cursor:'root'}});
  render(<HostedWorkspaceProjects/>);fireEvent.click(await screen.findByRole('button',{name:'Owned folder'}));await screen.findByRole('alert');expect(mocks.push).not.toHaveBeenCalled();expect(mocks.request.mock.calls.every(([path])=>!String(path).includes('provision'))).toBe(true);
 });
 it('unmounting the actor fences a late project confirmation',async()=>{
  const {actual,option,execution}=bound();let finish!:(v:unknown)=>void;mocks.request.mockImplementation(async(path:string)=>path.startsWith('/workspace-projects')?page([actual]):path.includes('/confirm')?new Promise(resolve=>{finish=resolve}):{data:[option],pagination:{hasMore:false,cursor:'root'}});
  const view=render(<HostedWorkspaceProjects/>);fireEvent.click(await screen.findByRole('button',{name:'Owned folder'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));view.unmount();finish({data:execution});await new Promise(resolve=>setTimeout(resolve,0));expect(mocks.push).not.toHaveBeenCalled();
 });
});
