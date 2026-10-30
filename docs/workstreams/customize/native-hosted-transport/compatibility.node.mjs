import {test} from "node:test";import assert from "node:assert/strict";import {createRequire} from "node:module";import path from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
import {transformed} from "./portable-compat.mjs";
const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(directory,"../../../.."),actualPhase=path.resolve(root,"../..");
const ts=createRequire(import.meta.url)(path.resolve(actualPhase,"../prd-ui-fixes/node_modules/typescript/lib/typescript.js"));
async function module(name){const js=ts.transpileModule(transformed(name),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;return import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));}
const client=await module("client.ts"),decoder=await module("decoders.ts");
const b={authorityId:"authority",connectionId:"connection",grantId:"grant",grantRevision:1,epoch:"epoch",nativeLibraryId:"library",nativeServiceInstanceId:"native",hostedServiceInstanceId:"hosted",nativeProjectId:"project",nativeProjectRevision:3,actorId:"user",installationId:"installation",hostedProjectId:"uuid",apiProject:"actual",visibility:"project"};
const reviewed={proposalHash:"a".repeat(64),status:"pending",updatedAt:"now",targetSkillId:"target-id",sourceProjectId:"source-project",sourceName:"source",expectedRevision:3,expectedSourceRevision:7,currentTarget:{id:"target-id",revision:3},currentSource:{id:"source-id",projectId:"source-project",name:"source",revision:7}};
const proposal={id:"proposal",projectId:"uuid",status:"pending",proposalType:"merge",targetSkillId:"target-id",targetName:"target",sourceProjectId:"source-project",sourceName:"source",expectedRevision:3,expectedSourceRevision:7,proposedState:{},evidence:[],observationIds:[],qualityScore:1,noveltyScore:1,createdAt:"now",updatedAt:"now",reviewer:null,reviewReason:null,appliedAt:null,rolledBackAt:null,currentSkill:{id:"target-id",revision:3,content:"target"},sourceSkill:{id:"source-id",projectId:"source-project",name:"source",revision:7,content:"source"},reviewed};
test("frozen reviews retain actual current UUIDs without inventing legacy API keys",()=>{const dto=decoder.proposal({data:proposal},b,"proposal");assert.deepEqual(dto.reviewed,reviewed);const result=client.descriptor({op:"approve",id:"proposal",reviewed:dto.reviewed,reviewer:"user"},b);assert.deepEqual(result.body,{reviewer:"user",reason:undefined});});
test("missing current-row comparisons cannot dispatch",()=>{const old={...reviewed};delete old.currentTarget;delete old.currentSource;assert.throws(()=>client.descriptor({op:"approve",id:"proposal",reviewed:old,reviewer:"user"},b),/current-row/);});
test("actual source UUID must come from matching permission-checked DTO",()=>{assert.throws(()=>decoder.proposal({data:{...proposal,sourceSkill:{...proposal.sourceSkill,id:"other"}}},b,"proposal"),/source comparison/);});
test("review baseline and observed revisions are separate and mismatches fail visibly",()=>{assert.throws(()=>decoder.proposal({data:{...proposal,reviewed:{...reviewed,expectedSourceRevision:6}}},b,"proposal"),/proposal baselines/);assert.throws(()=>decoder.proposal({data:{...proposal,reviewed:{...reviewed,currentTarget:{id:"target-id",revision:4}}}},b,"proposal"),/target comparison/);});
test("basic detail remains readable without gaining mutation review proof",()=>{const basic={...proposal};delete basic.reviewed;delete basic.sourceSkill;delete basic.currentSkill;assert.equal(decoder.proposal({data:basic},b,"proposal").reviewed,undefined);});
test("target absence must be explicit rather than a missing enrichment field",()=>{const absent={...proposal,reviewed:{...reviewed,currentTarget:null}};delete absent.currentSkill;assert.throws(()=>decoder.proposal({data:absent},b,"proposal"),/Target absence/);});
test("additive submit is closed and review-bound",()=>{assert.equal(client.descriptor({op:"submit",id:"proposal",reviewed:{...reviewed,status:"draft"},reviewer:"user"},b).path,"/api/v1/skills/proposals/proposal/submit?project=actual");assert.throws(()=>client.descriptor({op:"submit",id:"proposal",reviewed:{...reviewed,currentSource:{...reviewed.currentSource,cookie:"private"}},reviewer:"user"},b),/current-row/);});
const worker=path.resolve(actualPhase,"parallel/rust-api/docs/workstreams/rust-api/hosted-governance/proposed/hosted-governance.ts");
const core=await import(pathToFileURL(worker).href);
test("canonical whole-original hash preserves exact strings and code-unit key order",()=>{const one={id:"operation",binding:b,command:{op:"save",name:"release",filePath:"refs/参考.md",target:{id:"target-id",revision:3},content:"body\r\n  ",extra:{always_apply:0,files:'{"refs/参考.md":"text\\r\\n"}'}}};assert.notEqual(core.payloadHash(one),core.payloadHash({...one,command:{...one.command,content:"body\n"}}));assert.equal(core.canonical({"\uE000":false,"\u{10000}":true}),'{"𐀀":true,"":false}');});

test("proposal fingerprint must be returned by the actual owner, never missing or invented by this adapter",()=>{
 const missing={...reviewed};delete missing.proposalHash;
 assert.throws(()=>client.descriptor({op:"approve",id:"proposal",reviewed:missing,reviewer:"user"},b),/fingerprint/);
 assert.throws(()=>decoder.proposal({data:{...proposal,reviewed:{...reviewed,proposalHash:"invalid"}}},b,"proposal"),/actual-row review/);
 assert.equal(decoder.proposal({data:proposal},b,"proposal").reviewed.proposalHash,reviewed.proposalHash);
});

test("official committed34351 whole-original UTF8 vectors match actual frozen Core canonical hashes",async()=>{
 const fs=await import("node:fs");
 const file=JSON.parse(fs.readFileSync(new URL("./files/crates/adapters/src/remote_control/hosted/official-vectors.json",import.meta.url),"utf8"));
 assert.equal(file.vectors.length,2);
 for(const vector of file.vectors){assert.equal(core.canonical(vector.original),vector.canonical);assert.equal(core.payloadHash(vector.original),vector.payloadHash);}
});
