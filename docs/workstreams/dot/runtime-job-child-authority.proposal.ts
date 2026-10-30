import {spawn} from "node:child_process";
import {createManagedJobChild} from "../lib/dot-v2/managed-job-child.mjs";
import {createOriginalJobAuthority} from "../lib/dot-v2/job-original-authority.mjs";
import {JobResponseVerification} from "../lib/job-response-verification.js";
const authority=createOriginalJobAuthority();
const run=createManagedJobChild({environment:process.env,spawn,verifierFactory:()=>new JobResponseVerification(),fetchAssignment:()=>authority.request("assignment"),reportResult:(_identity,result)=>authority.request("result",{attemptId:authority.attemptId,result})});
try{process.exitCode=await run({runId:authority.runId,attemptId:authority.attemptId});}catch{console.error("Managed JobRun did not complete; original ownership retained.");process.exitCode=1;}
