import React,{StrictMode} from "react";
import {render,screen,fireEvent,waitFor,cleanup}from"@testing-library/react";
import{beforeEach,afterEach,it,expect,vi}from"vitest";
const state=vi.hoisted(()=>({fetch:vi.fn(),canChange:true,unknown:false,chatRevision:0,useMemory:true,projectless:false}));
vi.mock("../src/lib/api",()=>({dashboardFetch:state.fetch,getApiBase:()=>"/api/v1"}));
import{HostedWorkMemory}from"../src/app/components/memory-v2/HostedWorkMemory";
const selected={actorUserId:"owner",organizationId:"org",workspaceId:"workspace",runtimeId:"runtime",engineSessionId:"engine"};
const binding={...selected,projectId:"real-project",schemaVersion:1,available:true,contextConversationId:"distinct-context",scopeHash:"a".repeat(64),bindingHash:"b".repeat(64),bindingEpoch:2};
const json=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
beforeEach(()=>{
 window.localStorage.clear();state.fetch.mockReset();state.canChange=true;state.unknown=false;state.chatRevision=0;state.useMemory=true;state.projectless=false;
 state.fetch.mockImplementation(async(input:string,options:RequestInit={})=>{
  if(options.signal?.aborted)throw new DOMException("closed","AbortError");
  const url=new URL(input,"http://fixture.invalid");
  if(url.pathname.endsWith("/work-binding"))return json({...binding,...(state.projectless?{schemaVersion:2,projectId:null}:{}),canChange:state.canChange,canForget:state.canChange});
  if(options.method==="PUT"){
   if(state.unknown)throw new Error("Response lost after original dispatch");
   const body=JSON.parse(options.body as string);state.chatRevision++;state.useMemory=body.useMemory;
   return json({receipt:{status:"committed",operationId:body.operationId,scopeHash:binding.scopeHash,operation:"chat-policy",revision:state.chatRevision}});
  }
  if(url.pathname.endsWith("/policy"))return json({scopeHash:binding.scopeHash,chatId:"engine",bindingHash:binding.bindingHash,bindingEpoch:2,available:true,
   policy:{revision:0,enabled:true,useMemory:true,generate:false,externalContext:false},chat:{revision:state.chatRevision,useMemory:state.useMemory,contribute:false}});
  return new Response(JSON.stringify({error:{code:"NOT_FOUND"}}),{status:404});
 });
});
afterEach(cleanup);
it("drafts do not request a guessed binding",()=>{render(<HostedWorkMemory selected={null}/>);expect(state.fetch).not.toHaveBeenCalled();expect(screen.queryByRole("checkbox")).toBeNull();});
it("Strict Mode acquires actual binding, commits one exact chat policy and clears its metadata",async()=>{
 render(<StrictMode><HostedWorkMemory selected={selected}/></StrictMode>);
 const control=await screen.findByRole("checkbox",{name:"Use memories in this chat"});await waitFor(()=>expect(control).toBeEnabled());
 fireEvent.click(control);await waitFor(()=>expect(control).not.toBeChecked());
 const writes=state.fetch.mock.calls.filter(([,options])=>options.method==="PUT");expect(writes).toHaveLength(1);
 const [url,options]=writes[0];expect(new URL(url,"http://fixture.invalid").searchParams.get("projectId")).toBe("real-project");
 expect(options.headers["X-Veyra-Memory-Context"]).toBe("distinct-context");expect(JSON.parse(options.body).useMemory).toBe(false);
 await waitFor(()=>expect(window.localStorage.length).toBe(0));
 expect(screen.queryByText(/Memory used.*current response/)).toBeTruthy();
});
it("unknown dispatched change survives unmount/reload and cannot auto-resend",async()=>{
 state.unknown=true;const first=render(<HostedWorkMemory selected={selected}/>);
 const control=await screen.findByRole("checkbox",{name:"Use memories in this chat"});await waitFor(()=>expect(control).toBeEnabled());fireEvent.click(control);
 await screen.findByRole("button",{name:"Check operation status"});expect(window.localStorage.length).toBe(1);
 first.unmount();render(<HostedWorkMemory selected={selected}/>);await screen.findByRole("button",{name:"Check operation status"});
 expect(screen.getByRole("checkbox",{name:"Use memories in this chat"})).toBeDisabled();
 expect(state.fetch.mock.calls.filter(([,options])=>options.method==="PUT")).toHaveLength(1);
 const saved=window.localStorage.getItem(window.localStorage.key(0)!);expect(saved).toContain("operationId");expect(saved).not.toContain("Response lost");
});
it("read-only server binding keeps mutation controls disabled",async()=>{
 state.canChange=false;render(<HostedWorkMemory selected={selected}/>);const control=await screen.findByRole("checkbox",{name:"Use memories in this chat"});
 await screen.findByRole("button",{name:"Inspect stored recall"});expect(control).toBeDisabled();expect(screen.getByRole("button",{name:"Preview reset of learned recall"})).toBeDisabled();
});

it("projectless profile commits one policy change through the acquired null scope without a Project parameter",async()=>{
 state.projectless=true;render(<HostedWorkMemory selected={{...selected,expectedProjectId:null}}/>);
 const control=await screen.findByRole("checkbox",{name:"Use memories in this chat"});await waitFor(()=>expect(control).toBeEnabled());fireEvent.click(control);await waitFor(()=>expect(control).not.toBeChecked());
 const writes=state.fetch.mock.calls.filter(([,options])=>options.method==="PUT");expect(writes).toHaveLength(1);const url=new URL(writes[0][0],"http://fixture.invalid");expect(url.searchParams.get("projectless")).toBe("true");expect(url.searchParams.has("projectId")).toBe(false);
 const bindings=state.fetch.mock.calls.filter(([url])=>url.includes("/work-binding?"));expect(bindings.length).toBeGreaterThan(0);expect(bindings.every(([url])=>new URL(url,"http://fixture.invalid").searchParams.get("expectedProjectless")==="true")).toBe(true);await waitFor(()=>expect(window.localStorage.length).toBe(0));
});
