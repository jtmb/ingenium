import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { DotRepository } from "../lib/dot-v2/repository.js";
import { DotService, DotError } from "../lib/dot-v2/service.js";
import { createDotRouter } from "../lib/dot-v2/router.js";

const scope={organizationId:"org",ownerUserId:"owner",projectId:"project",executionBindingId:"native",executionBindingFingerprint:"host/workspace/epoch-1",conversationId:"conversation"};
const actor={id:"owner",organizationId:"org"};
let db:DatabaseSync,server:Server,base:string;
let failure=false;
beforeAll(async()=>{
 db=new DatabaseSync(":memory:");
 db.exec(readFileSync(new URL("../lib/dot-v2/schema.sql",import.meta.url),"utf8"));
 const transaction=<T,>(fn:()=>T):T=>{db.exec("BEGIN IMMEDIATE");try{const value=fn();db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}};
 const repository=new DotRepository(db,transaction);
 let sequence=0;
 const service=new DotService(repository,{require(){if(failure)throw Error("private SQL diagnostic");},requireSource(){},canReadMemory(){return true;}},{readAuthorizedJob(){throw new DotError("DOT_NOT_FOUND");},claim(){throw Error("No process may be launched by this router test");},requestCancellation(){},inspect(){return "unknown";}},()=>"2026-10-29T00:00:00.000Z",()=>`suggestion-${++sequence}`);
 const app=express();app.use(express.json());
 app.use("/api/v1/dot",createDotRouter(service,req=>{if(req.get("x-fixture-deny")==="1")throw new DotError("DOT_FORBIDDEN");return {actor,scope};},{page:()=>({data:[],nextCursor:null})}));
 server=createServer(app);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/dot`;
});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();});
const post=(body:unknown)=>fetch(`${base}/commands`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
describe("Dot router integration (requires coordinator resource/runtime lease)",()=>{
 for(const collection of ["suggestions","followups","operations","notifications","queue"]){
  it(`${collection}: bounded 200, invalid-page 422, denied 403, safe 500`,async()=>{
   const ok=await fetch(`${base}/${collection}`);expect(ok.status).toBe(200);expect(ok.headers.get("cache-control")).toBe("no-store");expect(await ok.json()).toHaveProperty("nextCursor");
   expect((await fetch(`${base}/${collection}?limit=101`)).status).toBe(422);
   expect((await fetch(`${base}/${collection}`,{headers:{"x-fixture-deny":"1"}})).status).toBe(403);
   failure=true;try{const response=await fetch(`${base}/${collection}`);expect(response.status).toBe(500);expect(await response.text()).not.toContain("private SQL");}finally{failure=false;}
  });
 }
 it("creates and reads an exact suggestion, then rejects stale dismissal",async()=>{
  const created=await post({type:"propose",input:{title:"Inspect progress",prompt:"Check existing task progress",source:{kind:"user",reference:"message"},capabilities:[],expiresAt:"2026-11-01T00:00:00.000Z"}});
  expect(created.status).toBe(201);const {data}=await created.json();expect(created.headers.get("location")).toContain(encodeURIComponent(data.id));
  const read=await fetch(`${base}/suggestions/${encodeURIComponent(data.id)}`);expect(read.status).toBe(200);expect((await read.json()).data.prompt).toBe("Check existing task progress");
  expect((await post({type:"dismiss",id:data.id,revision:0})).status).toBe(200);expect((await post({type:"dismiss",id:data.id,revision:0})).status).toBe(409);
 });
 it("invalid commands are 422, unknown items 404, and internal diagnostics stay private",async()=>{
  expect((await post({type:"cancel",id:"missing",revision:-1})).status).toBe(422);
  for(const collection of ["suggestions","followups","operations","notifications"])expect((await fetch(`${base}/${collection}/missing`)).status).toBe(404);
  failure=true;try{const response=await post({type:"propose",input:{title:"t",prompt:"p",source:{kind:"user",reference:"m"},capabilities:[],expiresAt:"2026-11-01T00:00:00.000Z"}});expect(response.status).toBe(500);expect(await response.text()).not.toContain("private SQL");}finally{failure=false;}
 });
});
