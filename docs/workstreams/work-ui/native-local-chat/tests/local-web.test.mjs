import test from "node:test";
import assert from "node:assert/strict";
import { LocalWebController, createLocalWebPort, webBounds } from "../sources/apps/web/src/features/work-ui/local/local-web-controller.mjs";
const owner = { installation_id:"actual-library", custodian_key:"actual-custodian", workspace_id:"11111111-1111-4111-8111-111111111111", revision:1, service_instance_id:"actual-service", environment:{kind:"windows"} };
const session_id="ses_"+"a".repeat(32), rect={x:300,y:80,width:700,height:500,viewport_width:1100,viewport_height:700};
function fixture() {
  const calls=[], failures=[], state={current:true,visibility:"hidden",lose:"",available:true};
  const binding={kind:"qualified",owner,session_id,binding_id:"original-binding",invalidation_epoch:"original-epoch"};
  const observation=()=>({binding_id:binding.binding_id,invalidation_epoch:binding.invalidation_epoch,visibility:state.visibility});
  const port={
    async readBinding(){calls.push("read-binding");return state.available?binding:{kind:"unavailable",reason:"Actual host not qualified"};},
    async show(){calls.push("show");state.visibility="visible";if(state.lose==="show")throw Error("lost show acknowledgement");return observation();},
    async hide(){calls.push("hide");state.visibility="hidden";if(state.lose==="hide")throw Error("lost hide acknowledgement");return observation();},
    async bounds(){calls.push("bounds");return observation();},
    async readState(){calls.push("read-state");return observation();},
    async release(){calls.push("release");if(state.lose==="release")throw Error("child close unconfirmed");state.visibility="closed";return observation();},
  };
  const controller=new LocalWebController({actualOwner:owner,sessionID:session_id,port,current:()=>state.current,
    refreshWork:async()=>{calls.push("read-work");},cleanupFailure:(...args)=>failures.push(args)});
  return {calls,failures,state,binding,port,controller};
}
test("Work is default and constructing the adapter invokes no host or engine operation",()=>{
  const f=fixture();assert.equal(f.controller.getSnapshot().view,"work");assert.deepEqual(f.calls,[]);
});
test("Work/Web uses one retained binding and show/hide, never a new URL or replacement host",async()=>{
  const f=fixture();await f.controller.enter(rect);await f.controller.work();await f.controller.enter(rect);
  assert.deepEqual(f.calls,["read-binding","show","hide","read-work","show"]);
  assert.equal(f.controller.getSnapshot().view,"web");await f.controller.dispose();assert.equal(f.state.visibility,"closed");
});
test("lost show/hide outcomes recover by reads without repeating the unknown action",async()=>{
  for(const action of ["show","hide"]){const f=fixture();if(action==="hide")await f.controller.enter(rect);f.state.lose=action;
    await assert.rejects(action==="show"?f.controller.enter(rect):f.controller.work(),/lost/);
    await assert.rejects(f.controller.enter(rect),/Check/);await f.controller.check();
    assert.equal(f.calls.filter(call=>call===action).length,1);assert.equal(f.controller.getSnapshot().pending,null);
  }
});
test("unqualified and wrong-owner bindings never call show",async()=>{
  for(const kind of ["unqualified","foreign"]){const f=fixture();if(kind==="unqualified")f.state.available=false;else f.binding.owner={...owner,revision:2};
    await assert.rejects(f.controller.enter(rect));assert.ok(!f.calls.includes("show"));
  }
});
test("positive cleanup is required; failed close retains its binding and reports exact handle",async()=>{
  const f=fixture();await f.controller.enter(rect);f.state.lose="release";await assert.rejects(f.controller.dispose(),/unconfirmed/);
  assert.equal(f.controller.getSnapshot().pending,"release");assert.equal(f.failures[0][0],"original-binding");
  await assert.rejects(f.controller.enter(rect),/Check/);assert.equal(f.calls.filter(call=>call==="show").length,1);
});
test("disposing during an observational binding read never shows a late child",async()=>{
  const f=fixture();let finish;f.port.readBinding=()=>new Promise(resolve=>{finish=resolve;});
  const opening=f.controller.enter(rect);await f.controller.dispose();finish(f.binding);await assert.rejects(opening,/conversation changed/);
  assert.ok(!f.calls.includes("show"));assert.ok(f.calls.includes("release"));
});
test("closed invoke adapter accepts no URL/header/method fallback and bounds stay inside viewport",()=>{
  const calls=[],port=createLocalWebPort((...args)=>{calls.push(args);return Promise.resolve();});
  assert.throws(()=>webBounds({...rect,width:2000}),/viewport/);assert.throws(()=>webBounds({...rect,url:"http://private"}),/viewport/);
  assert.throws(()=>port.show({binding_id:"http://private",invalidation_epoch:"epoch"},rect,()=>true),/binding/);
  assert.throws(()=>port.readBinding({owner,session_id,url:"http://private"},()=>true),/owner/);
  assert.equal(calls.length,0);
});
