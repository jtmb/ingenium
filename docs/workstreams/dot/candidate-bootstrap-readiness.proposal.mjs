import {verifyCandidateAgentMaterial,candidateAgentOverlay} from "../../../../packages/veyra-operations/core126-candidate-material.mjs";
import {spawn as nodeSpawn} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createCandidateChildCarrier,candidateSelection,candidateDenied,exact} from "./candidate-carrier.mjs";
import {openCandidateLoopback,CANDIDATE_CATALOG,CANDIDATE_CORE_ORIGIN} from "./candidate-loopback.mjs";
import {originalManagedJobInvocation} from "./candidate-original-invocation.mjs";
import {createOriginalJobAuthority,readOriginalJobCapability} from "./job-original-authority.mjs";
import {createOriginalJobCustody,createOriginalJobControl,openOriginalJobControl} from "./job-private-control.mjs";
import {prepareJobPrivateDirectories,writeOriginalJobPrivate,assertOriginalJobStaticFiles} from "./job-private-files.mjs";
import {assertOriginalBootstrapAssignment,readOriginalProtectedBroker} from "./job-bootstrap-runtime.mjs";
import {IMAGE_INPUTS,JOB_CONFIG,JOB_CONFIG_DIRECTORY,core126ClosedJobConfig,hash,freeze} from "./job-bootstrap-facade.mjs";
const sha=value=>createHash("sha256").update(value).digest("hex");
/** Data validation, NOT readiness/credential issuance. Original Core must return
 * this candidate branch only after its same-child SQL131 material CAS. */
export function assertCandidateBootstrapAssignment(value,binding,environment){
 exact(value,["binding","staticProfile","agent","model","candidate"]);assertOriginalBootstrapAssignment(value,environment);
 exact(value.candidate,["purpose","intentHash","childId","childBirthHash","expiresAt"]);
 if(value.candidate.purpose!=="candidate-inert-v1"||value.candidate.intentHash!==binding.intentHash||value.candidate.childId!==binding.childId||value.candidate.childBirthHash!==binding.childBirthHash||value.candidate.expiresAt!==binding.expiresAt||value.binding.runId!==binding.runId||value.binding.attemptId!==binding.attemptId||value.binding.candidatePurpose!=="candidate-inert-v1"||value.binding.candidateIntentHash!==binding.intentHash||value.binding.candidateChildId!==binding.childId||value.binding.candidateChildBirthHash!==binding.childBirthHash||Date.parse(value.binding.deadlineAt)!==binding.expiresAt||value.agent!=="qualification"||value.model!=="opencode/qualification-canary")candidateDenied();return value;
}
export function assertCandidateExecutionAssignment(value,expected,binding){
 exact(value,["runId","attemptId","workspaceId","bindingHash","runtimeId","projectId","organizationId","ownerUserId","executable","cwd","prompt","promptHash","agent","model","credentialBoundToOriginalRun","candidate"]);
 if(value.runId!==binding.runId||value.attemptId!==binding.attemptId||!["workspaceId","bindingHash","runtimeId","projectId","organizationId","ownerUserId"].every(k=>value[k]===expected.binding[k])||value.executable!=="opencode"||value.cwd!=="/workspace"||value.prompt!=="qualification-canary"||value.promptHash!==sha(value.prompt)||value.agent!==expected.agent||value.model!==expected.model||value.credentialBoundToOriginalRun!==true||JSON.stringify(value.candidate)!==JSON.stringify(expected.candidate))candidateDenied();return value;
}
/** New candidate executable only. It cannot be selected by a production frame.
 * Container enters WAITING without capability/material; same PID owns carrier,
 * inert trap, Core proxy, private control and original model child custody. */
export async function runOriginalCandidateBootstrap({binding:inputBinding,validateOriginalProtectedDeployment,verifierFactory,environment=process.env,stdin=process.stdin,stdout=process.stdout,spawn=nodeSpawn}){
 if(typeof validateOriginalProtectedDeployment!=="function"||typeof verifierFactory!=="function")candidateDenied();
 const selected=candidateSelection(inputBinding),env={...environment,INGENIUM_API_URL:CANDIDATE_CORE_ORIGIN};
 if(env.INGENIUM_JOB_RUN_ID!==selected.runId||env.INGENIUM_JOB_ATTEMPT_ID!==selected.attemptId)candidateDenied();
 const custody=createOriginalJobCustody();let binding,loopback,control,material,initial,broker;
 const carrier=createCandidateChildCarrier({input:stdin,output:stdout,binding:selected,onUnknown(){void custody.withdraw().catch(()=>{});},observeOriginalReadiness:()=>loopback.currentObservation()});
 const authority=createOriginalJobAuthority({environment:env});
 const current=async()=>{if(carrier.closed())candidateDenied();const expected=assertCandidateBootstrapAssignment(await authority.request("bootstrap-assignment"),binding,env);if(initial&&(hash(expected)!==hash(initial)))candidateDenied();if(material)verifyCandidateAgentMaterial(material,expected.binding,expected.agent);assertOriginalJobStaticFiles(expected.staticProfile,IMAGE_INPUTS);return expected;};
 const withdraw=async reason=>{const stopping=custody.withdraw();const recorded=await authority.request("withdraw",{runId:binding.runId,attemptId:binding.attemptId,reason}).then(()=>true,()=>false);void stopping.catch(()=>{});return{withdrawalRecorded:recorded,leaderStopRequested:true,wholeContainerRetired:false};};
 try{
  await carrier.initialized;binding=carrier.binding;await validateOriginalProtectedDeployment();prepareJobPrivateDirectories();
  loopback=await openCandidateLoopback(carrier);await carrier.observe(loopback.observation);
  // No capability reader, native CLI, assignment fetch or execution frame precedes this await.
  const released=await carrier.material();loopback.activate(released.capability);material=released.agentMaterial;
  const candidatePorts={
   validateOriginalProtectedDeployment:async()=>{await validateOriginalProtectedDeployment();},
   readOriginalJobFrame:async()=>released,
   writeOriginalPrivateCapability:async(path,capability)=>writeOriginalJobPrivate(path,capability),
   fetchOriginalAssignment:async()=>{initial=await current();return initial;},
   writeOriginalPrivateJson:async(path,value)=>writeOriginalJobPrivate(path,value),
   assertOriginalImageIsolation:async({config})=>{await current();if(hash(config)!==hash(core126ClosedJobConfig())||hash(JSON.parse(readFileSync(JOB_CONFIG,"utf8")))!==hash(config))candidateDenied();broker=readOriginalProtectedBroker();},
   runOriginalChild:async()=>{
    const controller=createOriginalJobControl({capability:readOriginalJobCapability(),identity:{runId:binding.runId,attemptId:binding.attemptId},loadBinding:async()=>{
     if(custody.isWithdrawn())candidateDenied();const expected=await current();return freeze({agentName:expected.agent,admission:{...expected.binding,model:expected.model},material,broker,mcpEnvironment:{PATH:"/usr/local/bin:/usr/bin:/bin",INGENIUM_API_URL:CANDIDATE_CORE_ORIGIN,INGENIUM_MCP_AUDIENCE:"job-run",INGENIUM_JOB_RUN_ID:binding.runId,INGENIUM_JOB_ATTEMPT_ID:binding.attemptId,INGENIUM_MCP_CREDENTIAL_FILE:"/run/ingenium-runtime/capability",INGENIUM_RUNTIME_CREDENTIAL_FILE:"/run/ingenium-runtime/capability"}});
    },withdraw});control=await openOriginalJobControl(controller);
    const expected=await current(),assignment=assertCandidateExecutionAssignment(await authority.request("assignment"),expected,binding);
    // Identical original argv/cwd/env producer, then candidate-only catalog switches.
    // No production profileQualified field is manufactured or consumed here.
    const invocation=originalManagedJobInvocation(assignment,{runId:binding.runId,attemptId:binding.attemptId},env);
    Object.assign(invocation.options.env,{OPENCODE_MODELS_PATH:CANDIDATE_CATALOG,OPENCODE_DISABLE_MODELS_FETCH:"1",INGENIUM_CANDIDATE_ORIGINAL_BINDING:JSON.stringify(binding)});
    custody.assertMaySpawn();if(carrier.closed())candidateDenied();const child=spawn(invocation.binary,invocation.args,invocation.options);custody.retain(child);const verifier=verifierFactory();let bytes=0;
    return await new Promise((resolve,reject)=>{let settled=false;const fail=error=>{if(settled)return;settled=true;void custody.withdraw().catch(()=>{});reject(error);};
     child.stdout.on("data",data=>{bytes+=data.length;if(bytes>1024*1024){fail(Error("Original candidate output limit"));return;}try{verifier.accept(data);}catch(error){fail(error);}});child.stderr.on("data",data=>{bytes+=data.length;if(bytes>1024*1024)fail(Error("Original candidate output limit"));});child.once("error",fail);child.once("close",code=>{if(settled)return;settled=true;let result;try{result=verifier.finish();}catch(error){reject(error);return;}Promise.resolve(authority.request("result",{attemptId:binding.attemptId,result:{exitCode:Number.isInteger(code)?code:-1,verifiedResponse:code===0&&result.verified===true,events:[JSON.stringify(result.verified===true?{type:"step_finish",part:{type:"step-finish",reason:"stop"}}:{type:"error"})]}})).then(()=>resolve(code===0&&result.verified===true?0:1),reject);});
    });
   },
  };
  // Candidate-purpose bootstrap mirrors original ordering with a distinct closed
  // verifier/overlay. It cannot call production's profileHash-only projector.
  await candidatePorts.validateOriginalProtectedDeployment();
  const frame=await candidatePorts.readOriginalJobFrame();
  await candidatePorts.writeOriginalPrivateCapability("/run/ingenium-runtime/capability",frame.capability);
  const expected=await candidatePorts.fetchOriginalAssignment();
  const checked=verifyCandidateAgentMaterial(frame.agentMaterial,expected.binding,expected.agent);
  const overlay=candidateAgentOverlay(checked,expected.binding,expected.agent);
  await candidatePorts.assertOriginalImageIsolation({config:core126ClosedJobConfig()});
  await candidatePorts.writeOriginalPrivateJson(JOB_CONFIG_DIRECTORY+"/opencode.json",overlay);
  await candidatePorts.writeOriginalPrivateJson("/run/ingenium-runtime/job/material.json",checked);
  return await candidatePorts.runOriginalChild();
 }catch(error){if(material)await withdraw("CORE126_CANDIDATE_PARENT_STOP");throw error;}
 finally{carrier.stop();await custody.withdraw();await control?.close();await loopback?.close();}
}
