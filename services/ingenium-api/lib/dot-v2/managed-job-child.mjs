// Fixed per-container child scope. All assignment/grant/result ports are the existing Core API owner.
import {createHash} from "node:crypto";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=s=>createHash("sha256").update(s).digest("hex");
const unavailable=()=>{throw Object.assign(Error("Managed JobRun profile unavailable"),{code:"MANAGED_JOB_PROFILE_UNAVAILABLE"});};
export function createManagedJobChild({fetchAssignment,reportResult,spawn,verifierFactory,environment}){
 return async function run(identity){
  if(!identity||Object.keys(identity).sort().join("|")!=="attemptId|runId"||![identity.runId,identity.attemptId].every(v=>uuid.test(v)))unavailable();
  const a=await fetchAssignment(identity); // Reuses run-scoped credential and current original Core grants.
  if(!a||a.runId!==identity.runId||a.attemptId!==identity.attemptId||a.workspaceId!==environment.INGENIUM_WORKSPACE_ID||a.bindingHash!==environment.INGENIUM_STORAGE_MAPPING_HASH||a.runtimeId!==environment.INGENIUM_RUNTIME_ID||a.projectId!==environment.INGENIUM_PROJECT_ID||a.organizationId!==environment.INGENIUM_ORGANIZATION_ID||a.ownerUserId!==environment.INGENIUM_RUNTIME_OWNER_ID||!a.profileQualified||a.executable!=="opencode"||a.cwd!=="/workspace"||!a.credentialBoundToOriginalRun||typeof a.prompt!=="string"||!a.prompt.length||a.prompt.length>16000||sha(a.prompt)!==a.promptHash||typeof a.agent!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(a.agent)||typeof a.model!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}\/[^\s\u0000-\u001f\u007f]{1,256}$/u.test(a.model))unavailable();
  const names=["PATH","HOME","XDG_CONFIG_HOME","XDG_DATA_HOME","XDG_STATE_HOME","TMPDIR","INGENIUM_API_URL","INGENIUM_PROJECT","INGENIUM_PROJECT_ID","INGENIUM_ORGANIZATION_ID","INGENIUM_RUNTIME_ID","INGENIUM_RUNTIME_OWNER_ID","INGENIUM_WORKSPACE_ID","INGENIUM_STORAGE_MAPPING_HASH"];
  const env=Object.fromEntries(names.filter(n=>environment[n]!==undefined).map(n=>[n,environment[n]]));
  Object.assign(env,{PWD:"/app",OPENCODE_CONFIG_DIR:"/home/appuser/.config/opencode/runtime",OPENCODE_CONFIG:"/usr/local/share/ingenium/opencode-managed/opencode.json",INGENIUM_WORKTREE:"/workspace",INGENIUM_MCP_AUDIENCE:"job-run",INGENIUM_MCP_CREDENTIAL_FILE:"/run/ingenium-runtime/capability",INGENIUM_RUNTIME_CREDENTIAL_FILE:"/run/ingenium-runtime/capability",INGENIUM_JOB_RUN_ID:identity.runId,INGENIUM_JOB_ATTEMPT_ID:identity.attemptId});
  const verifier=verifierFactory();
  return await new Promise((resolve,reject)=>{
   // Fixed binary/argv/cwd, no shell and no host/container selector from assignment or HTTP.
   const proc=spawn("opencode",["run",a.prompt,"--agent",a.agent,"--model",a.model,"--auto","--standalone","--format","json"],{cwd:"/workspace",env,stdio:["ignore","pipe","pipe"],shell:false,detached:false});
   let done=false;proc.stdout?.on("data",value=>verifier.accept(value));proc.stderr?.on("data",()=>{});
   proc.on("error",reject);proc.on("close",code=>{if(done)return;done=true;const result=verifier.finish();
    // No raw output, prompt, transcript, credential or provider text is returned or logged.
    Promise.resolve(reportResult(identity,{exitCode:Number.isInteger(code)?code:-1,verifiedResponse:code===0&&result.verified===true,events:[JSON.stringify(result.verified===true?{type:"step_finish",part:{type:"step-finish",reason:"stop"}}:{type:"error"})]})).then(()=>resolve(code===0&&result.verified===true?0:1),reject);
   });
  });
 };
}
