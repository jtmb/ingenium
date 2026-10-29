import test from "node:test";
import assert from "node:assert/strict";
import {createProjectHandlers} from "../lib/projects-v2/handlers.mjs";
import {ProjectError} from "../../../packages/veyra-projects/domain.mjs";

function response() {return {statusCode:200,body:null,headers:{},
  status(code){this.statusCode=code;return this;},location(url){this.headers.Location=url;return this;},
  json(value){this.body=value;return this;}};}
test("handlers authenticate before catalog access; caller-provided ownership is ignored",async()=>{
  let calls=0;
  const handlers=createProjectHandlers({catalog:{get(){calls++;}},operations:{},resolveScope:async()=>null});
  const res=response();
  await handlers.get({params:{id:"private"},body:{scope:{ownerUserId:"victim"}}},res);
  assert.equal(res.statusCode,401);assert.equal(calls,0);
});
test("create returns actual identity and Location; validation, denial and unexpected DB failure are safe",async()=>{
  const scope={ownerUserId:"owner"};
  const catalog={create(s,draft,id){assert.equal(s,scope);return {id,label:draft.label};},
    get(){throw new ProjectError("FORBIDDEN",403);},
    list(){throw Error("SQL includes private path and credential");}};
  const handlers=createProjectHandlers({catalog,operations:{},resolveScope:async()=>scope});
  const res=response();
  await handlers.create({body:{id:"project-a",label:"Alpha",roots:[],scope:{ownerUserId:"victim"}}},res);
  assert.equal(res.statusCode,201);assert.equal(res.headers.Location,"/api/v1/workspace-projects/project-a");
  const invalid=response();await handlers.create({body:{}},invalid);assert.equal(invalid.statusCode,422);
  const denied=response();await handlers.get({params:{id:"hidden"}},denied);assert.equal(denied.statusCode,403);
  const failed=response();await handlers.list({query:{}},failed);
  assert.equal(failed.statusCode,500);assert.equal(failed.body.error.code,"INTERNAL_ERROR");
  assert.equal(JSON.stringify(failed.body).includes("credential"),false);
});
test("unknown operation returns accepted with durable original operation identity",async()=>{
  const handlers=createProjectHandlers({catalog:{},resolveScope:async()=>({}),operations:{
    async execute(){return {operationId:"op-a",state:"unknown",result:null};}}});
  const res=response();await handlers.execute({body:{operationId:"op-a"}},res);
  assert.equal(res.statusCode,202);assert.equal(res.body.data.operationId,"op-a");
});
