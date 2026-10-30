import { readFileSync, lstatSync } from "node:fs";
import { spawn } from "node:child_process";
import { createManagedJobChild } from "../lib/dot-v2/managed-job-child.mjs";
import { JobResponseVerification } from "../lib/job-response-verification.js";
const runId=process.env.INGENIUM_JOB_RUN_ID??"",attemptId=process.env.INGENIUM_JOB_ATTEMPT_ID??"";
const file="/run/ingenium-runtime/capability",stat=lstatSync(file);
if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.uid!==process.getuid?.())throw Error("Original-run capability unavailable");
const token=readFileSync(file,"utf8").trim(),base=new URL(process.env.INGENIUM_API_URL??"");
if(!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token)||base.protocol!=="http:"||base.username||base.password||base.pathname!=="/api/v1"||base.search||base.hash)throw Error("Original-run API authority unavailable");
async function request(operation:string,body?:unknown){
 const url=new URL(base);url.pathname+=`/runtime/job-runs/${encodeURIComponent(runId)}/${operation}`;
 const response=await fetch(url,{method:body===undefined?"GET":"POST",redirect:"error",headers:{Authorization:`Bearer ${token}`,Accept:"application/json",...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});
 if(!response.ok){await response.body?.cancel();throw Error("Original-run API authority denied operation");}const json=await response.json() as {data:unknown};return json.data;
}
const run=createManagedJobChild({environment:process.env,spawn,verifierFactory:()=>new JobResponseVerification(),fetchAssignment:()=>request("assignment"),reportResult:(_identity:unknown,result:unknown)=>request("result",{attemptId,result})});
try{process.exitCode=await run({runId,attemptId});}catch{console.error("Managed JobRun did not complete; original ownership retained.");process.exitCode=1;}
