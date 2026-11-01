import React from 'react';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({auth:{user:{id:'alice',status:'active'},session:{id:'session-a'},installationAdmin:false},list:vi.fn()}));
vi.mock('../src/lib/AuthContext',()=>({useOptionalAuth:()=>state.auth}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('../src/lib/api',()=>({api:{projects:{list:state.list}}}));
import {ProjectProvider,useProject,useGlobalProject} from '../src/lib/ProjectContext';
function Name(){return <p>Scoped project: {useProject()}</p>}
function Global(){const s=useGlobalProject();return <p>{s.loading?'Resolving installation':s.project??s.error?.message??'No installation'}</p>}
const app=()=> <ProjectProvider><Name/></ProjectProvider>;
const global=(name:string)=>({data:[{name,is_global:true}]});
function deferred(){let resolve!:(value:any)=>void;let reject!:(error:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
beforeEach(()=>{localStorage.clear();state.auth={user:{id:'alice',status:'active'},session:{id:'session-a'},installationAdmin:false};state.list.mockReset()});
afterEach(()=>cleanup());
describe('current-session project resolution',()=>{
 it('withdraws old project content immediately when the account changes',async()=>{
  const next=deferred();state.list.mockResolvedValueOnce(global('alice-project')).mockReturnValueOnce(next.promise);
  const v=render(app());await screen.findByText('Scoped project: alice-project');
  state.auth={...state.auth,user:{id:'bob',status:'active'},session:{id:'session-b'}};v.rerender(app());
  expect(screen.queryByText('Scoped project: alice-project')).toBeNull();
  expect(screen.getByText('Resolving project context…')).toBeTruthy();
  await act(async()=>next.resolve(global('bob-project')));await screen.findByText('Scoped project: bob-project');expect(state.list).toHaveBeenCalledTimes(2);
 });
 it('ignores a previous account response that arrives after the new account',async()=>{
  const old=deferred(),next=deferred();state.list.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const v=render(app());state.auth={...state.auth,user:{id:'bob',status:'active'},session:{id:'session-b'}};v.rerender(app());
  await act(async()=>next.resolve(global('bob-project')));await screen.findByText('Scoped project: bob-project');
  await act(async()=>old.resolve(global('alice-project')));expect(screen.queryByText('Scoped project: alice-project')).toBeNull();expect(screen.getByText('Scoped project: bob-project')).toBeTruthy();
 });
 it('rechecks installation mapping on session replacement for the same account',async()=>{
  const next=deferred();state.list.mockResolvedValueOnce(global('previous-installation')).mockReturnValueOnce(next.promise);
  const v=render(<Global/>);await screen.findByText('previous-installation');state.auth={...state.auth,session:{id:'session-a2'}};v.rerender(<Global/>);
  expect(screen.queryByText('previous-installation')).toBeNull();expect(screen.getByText('Resolving installation')).toBeTruthy();
  await act(async()=>next.reject(Error('Access withdrawn')));await screen.findByText('Access withdrawn');expect(state.list).toHaveBeenCalledTimes(2);
 });
 it('does not reuse a fulfilled grant after unmount and revocation',async()=>{
  state.list.mockResolvedValueOnce(global('revoked-project')).mockRejectedValueOnce(Error('Access withdrawn'));
  const v=render(app());await screen.findByText('Scoped project: revoked-project');v.unmount();render(app());
  await screen.findByText('Access withdrawn');expect(screen.queryByText('Scoped project: revoked-project')).toBeNull();expect(state.list).toHaveBeenCalledTimes(2);
 });
 it('retries a transient project-list failure on a later mount',async()=>{
  state.list.mockRejectedValueOnce(Error('Temporarily offline')).mockResolvedValueOnce(global('restored-project'));
  const v=render(app());await screen.findByText('Temporarily offline');v.unmount();render(app());await screen.findByText('Scoped project: restored-project');expect(state.list).toHaveBeenCalledTimes(2);
 });
 it('keeps projectless Work independent of legacy project discovery',async()=>{
  render(<ProjectProvider projectless><p>Projectless Work</p></ProjectProvider>);expect(screen.getByText('Projectless Work')).toBeTruthy();await waitFor(()=>expect(state.list).not.toHaveBeenCalled());
 });
});