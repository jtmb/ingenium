import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const calls=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../src/lib/api',()=>({request:calls.api,ApiError:class ApiError extends Error{constructor(readonly status:number){super('API failure')}}}));
import {useRuntimeLaunch,type RuntimeWorkspaceController} from '../src/lib/use-runtime-launch';
const id='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222';
const scope={schemaVersion:2 as const,instanceId:'a'.repeat(32),organizationId:org,workspaceId:'workspace',runtimeId:id,bindingHash:'b'.repeat(64),bindingEpoch:1};
function controller(runtimeId=id):RuntimeWorkspaceController{return {mode:'isolated',status:'ready',workspaces:[],selectedWorkspaceId:'workspace',confirmedWorkspaceId:'workspace',confirmedRuntimeId:runtimeId,confirmedProjectName:null,error:null,selectWorkspace:vi.fn(),start:vi.fn(),retry:vi.fn(),executionScope:{...scope,runtimeId}}}
const launch=(runtimeId=id)=>({data:{schemaVersion:2,instanceId:scope.instanceId,organizationId:org,scopeKind:'workspace',projectId:null,workspaceId:'workspace',runtimeId,launchUrl:'https://web--'+runtimeId+'.runtime.example.test/__ingenium/exchange',status:'ready'}});
const deferred=()=>{let resolve!:(v:unknown)=>void;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
beforeEach(()=>{calls.api.mockReset();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200}))});afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('uses explicit projectless launch identity and original private exchange/health flow',async()=>{
 calls.api.mockResolvedValue(launch());const {result}=renderHook(()=>useRuntimeLaunch('web',controller()));await waitFor(()=>expect(result.current.status).toBe('ready'));
 expect(calls.api.mock.calls[0][0]).toBe('/workspace-execution/launch?organizationId='+org);const body=JSON.parse(calls.api.mock.calls[0][1].body);expect(body).toEqual({audience:'web',workspaceId:'workspace',runtimeId:id,exchangeProof:expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)});expect(fetch).toHaveBeenCalledTimes(2);expect(result.current.url).toBe('https://web--'+id+'.runtime.example.test/');
});
it('mismatched canonical installation cannot reach the gateway exchange',async()=>{
 const wrong=launch();wrong.data.instanceId='c'.repeat(32);calls.api.mockResolvedValue(wrong);const {result}=renderHook(()=>useRuntimeLaunch('web',controller()));await waitFor(()=>expect(result.current.status).toBe('unavailable'));expect(fetch).not.toHaveBeenCalled();expect(result.current.url).toBeNull();
});
it('late launch response after target change never redeems the old proof',async()=>{
 const old=deferred(),next=deferred();calls.api.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);const {result,rerender}=renderHook(({target})=>useRuntimeLaunch('web',controller(target)),{initialProps:{target:id}});await waitFor(()=>expect(calls.api).toHaveBeenCalledTimes(1));rerender({target:'33333333-3333-4333-8333-333333333333'});await waitFor(()=>expect(calls.api).toHaveBeenCalledTimes(2));await act(async()=>{old.resolve(launch());await old.promise});expect(fetch).not.toHaveBeenCalled();expect(result.current.url).toBeNull();
});
it('a new target cannot render the old iframe URL even in the first render before effects',async()=>{
 calls.api.mockResolvedValueOnce(launch()).mockImplementation(()=>new Promise(()=>{}));const observed:Array<{target:string;url:string|null}>=[];const {result,rerender}=renderHook(({target})=>{const value=useRuntimeLaunch('web',controller(target));observed.push({target,url:value.url});return value},{initialProps:{target:id}});await waitFor(()=>expect(result.current.status).toBe('ready'));const next='33333333-3333-4333-8333-333333333333';rerender({target:next});expect(observed.filter(r=>r.target===next).every(r=>r.url===null)).toBe(true);
});
it('explicit legacy controller retains the original browser launch contract',async()=>{
 calls.api.mockResolvedValue({data:{launchUrl:launch().data.launchUrl,status:'ready'}});const {result}=renderHook(()=>{const target=controller();delete target.executionScope;return useRuntimeLaunch('web',target)});await waitFor(()=>expect(result.current.status).toBe('ready'));expect(calls.api.mock.calls[0][0]).toBe('/runtimes/browser/launch');expect(JSON.parse(calls.api.mock.calls[0][1].body).runtimeId).toBeUndefined();
});
