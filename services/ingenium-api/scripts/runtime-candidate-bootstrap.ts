import {agents} from "ingenium-core";
import {JobResponseVerification} from "../lib/job-response-verification.js";
import {parseStrictJobJson} from "../lib/dot-v2/job-bootstrap-frame.mjs";
import {runOriginalCandidateBootstrap} from "../lib/dot-v2/candidate-bootstrap-runtime.mjs";
try{
 const raw=process.env.INGENIUM_CANDIDATE_WAITING_SELECTION;
 if(typeof raw!=="string"||Buffer.byteLength(raw)>2048)throw Error("Original candidate selection unavailable");
 const binding=parseStrictJobJson(Buffer.from(raw),2048);
 // Never print carrier messages, credentials, material, RPC bodies or model output.
 process.exitCode=await runOriginalCandidateBootstrap({binding,validateOriginalProtectedDeployment:()=>agents.validateProtectedOpenCodeDeployment(),verifierFactory:()=>new JobResponseVerification()});
}catch{console.error("Original candidate bootstrap unavailable; original custody retained.");process.exitCode=1;}
