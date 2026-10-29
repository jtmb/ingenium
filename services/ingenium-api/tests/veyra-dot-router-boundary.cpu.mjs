import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import { Server, Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { DotRepository } from "../lib/dot-v2/repository.ts";
import { DotService, DotError } from "../lib/dot-v2/service.ts";

const expressPath=process.env.VEYRA_DOT_TEST_EXPRESS;
test("in-process Express/SQLite router boundary with sockets disabled",{skip:!expressPath},async t=>{
 const express=createRequire(import.meta.url)(expressPath);
 const {createDotRouter}=await import("../lib/dot-v2/router.ts");
 const listen=Server.prototype.listen,connect=Socket.prototype.connect;
 Server.prototype.listen=function(){throw Error("Router boundary tests cannot listen");};
 Socket.prototype.connect=function(){throw Error("Router boundary tests cannot connect");};
 t.after(()=>{Server.prototype.listen=listen;Socket.prototype.connect=connect;});
 const db=new DatabaseSync(":memory:");t.after(()=>db.close());db.exec(readFileSync(new URL("../lib/dot-v2/schema.sql",import.meta.url),"utf8"));
 const scope={organizationId:"org",ownerUserId:"owner",projectId:"project",executionBindingId:"native",executionBindingFingerprint:"host/workspace/epoch-1",conversationId:"conversation"};
 const actor={id:"owner",organizationId:"org"};let failure=false,sequence=0;
 const transaction=fn=>{db.exec("BEGIN IMMEDIATE");try{const result=fn();db.exec("COMMIT");return result;}catch(error){db.exec("ROLLBACK");throw error;}};
 const service=new DotService(new DotRepository(db,transaction),{require(){if(failure)throw Error("private SQL diagnostic");},requireSource(){},canReadMemory(){return true;}},{readAuthorizedJob(){throw new DotError("DOT_NOT_FOUND");},claim(){throw Error("No job execution in router tests");},requestCancellation(){},inspect(){return "unknown";}},()=>"2026-10-29T00:00:00.000Z",()=>`boundary-${++sequence}`);
 const app=express();app.use("/api/v1/dot",createDotRouter(service,req=>{if(req.get("x-fixture-deny")==="1")throw new DotError("DOT_FORBIDDEN");return {actor,scope};},{page:()=>({data:[],nextCursor:null})}));
 async function request(method,path,body,headers={}){
  return new Promise((resolve,reject)=>{
   const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}});
   const req=new IncomingMessage(socket);req.method=method;req.url="/api/v1/dot"+path;req.headers={host:"fixture.invalid",...headers};req.body=body;
   const res=new ServerResponse(req);const timer=setTimeout(()=>reject(Error("Router did not finish")),1000);
   res.end=chunk=>{clearTimeout(timer);socket.destroy();const text=chunk?String(chunk):"";resolve({status:res.statusCode,headers:res.getHeaders(),body:text?JSON.parse(text):null});return res;};
   app.handle(req,res,error=>{clearTimeout(timer);socket.destroy();reject(error??Error("Route not handled"));});
  });
 }
 for(const collection of ["suggestions","followups","operations","notifications","queue"]){
  await t.test(`${collection}: actual route 200, 422, 403 and sanitized 500`,async()=>{
   const ok=await request("GET","/"+collection);assert.equal(ok.status,200);assert.equal(ok.headers["cache-control"],"no-store");assert.ok("nextCursor" in ok.body);
   assert.equal((await request("GET",`/${collection}?limit=101`)).status,422);
   assert.equal((await request("GET","/"+collection,undefined,{"x-fixture-deny":"1"})).status,403);
   failure=true;try{const denied=await request("GET","/"+collection);assert.equal(denied.status,500);assert.doesNotMatch(JSON.stringify(denied.body),/private SQL/);}finally{failure=false;}
  });
 }
 await t.test("create/read/dismiss preserve item identity and stale revision conflict",async()=>{
  const created=await request("POST","/commands",{type:"propose",input:{title:"Inspect progress",prompt:"Check existing task",source:{kind:"user",reference:"message"},capabilities:[],expiresAt:"2026-11-01T00:00:00.000Z"}});
  assert.equal(created.status,201);const id=created.body.data.id;assert.ok(created.headers.location.endsWith(encodeURIComponent(id)));
  const item=await request("GET","/suggestions/"+id);assert.equal(item.status,200);assert.equal(item.body.data.prompt,"Check existing task");
  assert.equal((await request("POST","/commands",{type:"dismiss",id,revision:0})).status,200);
  assert.equal((await request("POST","/commands",{type:"dismiss",id,revision:0})).status,409);
 });
 await t.test("invalid command 422, unavailable items 404 and private error sanitization",async()=>{
  assert.equal((await request("POST","/commands",{type:"cancel",id:"missing",revision:-1})).status,422);
  for(const collection of ["suggestions","followups","operations","notifications"])assert.equal((await request("GET",`/${collection}/missing`)).status,404);
  failure=true;try{const result=await request("POST","/commands",{type:"propose",input:{title:"t",prompt:"p",source:{kind:"user",reference:"m"},capabilities:[],expiresAt:"2026-11-01T00:00:00.000Z"}});assert.equal(result.status,500);assert.doesNotMatch(JSON.stringify(result.body),/private SQL/);}finally{failure=false;}
 });
});
