import {agents} from "ingenium-core";
import {JobResponseVerification} from "../lib/job-response-verification.js";
import {runOriginalManagedJobBootstrap} from "../lib/dot-v2/job-bootstrap-runtime.mjs";
try{process.exitCode=await runOriginalManagedJobBootstrap({validateOriginalProtectedDeployment:()=>agents.validateProtectedOpenCodeDeployment(),verifierFactory:()=>new JobResponseVerification()});}
catch{console.error("Managed JobRun bootstrap did not complete; original custody retained.");process.exitCode=1;}
