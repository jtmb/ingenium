import test from "node:test";
import assert from "node:assert/strict";
import {createNativeExecutionHandlers} from "../lib/projects-v2/native-handlers.mjs";
import {ProjectError} from "../../../packages/veyra-projects/domain.mjs";
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},
  json(value){this.body=value;return this;}};}
test("native handlers authenticate before resolving a binding or invoking a native owner",async()=>{
  let calls=0;
  const handlers=createNativeExecutionHandlers({native:{},resolveScope:async()=>null,
    resolveContext:async()=>{calls++;}});
  const res=response();await handlers.terminalDispatch({body:{binding:{hostId:"spoof"}}},res);
  assert.equal(res.statusCode,401);assert.equal(calls,0);
});
test("native handler forwards server-derived scope/binding and untouched reviewed original",async()=>{
  const scope={instanceId:"install",organizationId:"org",ownerUserId:"alice"};
  const binding={id:"authorized"};
  const original={request_id:"original",operation:{kind:"commit",message:"Exact\r\ntext"}};
  let called;
  const handlers=createNativeExecutionHandlers({resolveScope:async()=>scope,
    resolveContext:async()=>({projectId:"authorized-project",binding}),
    native:{async submitReviewed(input){called=input;return {state:"pending",result:null};}}});
  const res=response();
  await handlers.gitSubmit({body:{scope:{ownerUserId:"victim"},projectId:"spoof",
    binding:{id:"spoof"},domain:"change",original}},res);
  assert.equal(res.statusCode,202);assert.deepEqual(called.scope,scope);
  assert.equal(called.binding.id,"authorized");assert.equal(called.projectId,"authorized-project");
  assert.deepEqual(called.original,original);
});
test("native handlers surface explicit projectless refusal and sanitize transport failures",async()=>{
  const handlers=createNativeExecutionHandlers({resolveScope:async()=>({instanceId:"install"}),
    resolveContext:async()=>({projectId:null,binding:{id:"private-selected"}}),
    native:{async terminalDispatch(){throw new ProjectError("NATIVE_PROJECTLESS_UNSUPPORTED",501);},
      async reviewRead(){throw Error("credential and private path");}}});
  const res=response();await handlers.terminalDispatch({body:{}},res);
  assert.equal(res.statusCode,501);assert.equal(res.body.error.code,"NATIVE_PROJECTLESS_UNSUPPORTED");
  const fail=response();await handlers.gitRead({body:{}},fail);
  assert.equal(fail.statusCode,500);assert.equal(JSON.stringify(fail.body).includes("credential"),false);
});
