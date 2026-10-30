import {spawn as nodeSpawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {createManagedJobChild} from "./managed-job-child.mjs";
import {createOriginalJobAuthority,readOriginalJobCapability} from "./job-original-authority.mjs";
import {readOriginalJobFrame} from "./job-bootstrap-frame.mjs";
import {createOriginalJobCustody,createOriginalJobControl,openOriginalJobControl} from "./job-private-control.mjs";
import {prepareJobPrivateDirectories,writeOriginalJobPrivate,assertOriginalJobStaticFiles} from "./job-private-files.mjs";
import {bootstrapCore126Job,verifyCore126AgentMaterial,IMAGE_INPUTS,BROKER_PROFILE,JOB_CONFIG,JOB_CONFIG_DIRECTORY,core126ClosedJobConfig,hash,freeze} from "./job-bootstrap-facade.mjs";
const deny=()=>{throw Error("Original JobRun bootstrap unavailable");};
export function assertOriginalBootstrapAssignment(expected,environment){
 const b=expected?.binding;if(!b||b.runId!==environment.INGENIUM_JOB_RUN_ID||b.attemptId!==environment.INGENIUM_JOB_ATTEMPT_ID||b.runtimeId!==environment.INGENIUM_RUNTIME_ID||b.projectId!==environment.INGENIUM_PROJECT_ID||b.organizationId!==environment.INGENIUM_ORGANIZATION_ID||b.ownerUserId!==environment.INGENIUM_RUNTIME_OWNER_ID||b.workspaceId!==environment.INGENIUM_WORKSPACE_ID||b.bindingHash!==environment.INGENIUM_STORAGE_MAPPING_HASH||expected.staticProfile?.imageId!==b.imageId||typeof expected.model!=="string"||!expected.model.includes('/'))deny();return expected;
}
/** Same immutable protected enforcer definition; guarded raw profile and enforcer hashes precede this read. */
export function readOriginalProtectedBroker(readProfile=()=>readFileSync(BROKER_PROFILE,'utf8')){
 const raw=readProfile(),end=raw.indexOf('\n---\n',4);if(!raw.startsWith('---\n')||end===-1)deny();
 return {id:'ingenium-llm-broker',name:'ingenium-llm-broker',description:'Internal agent for Ingenium LLM broker — never invoke directly',mode:'subagent',hidden:true,system:raw.slice(end+5).trim(),permissions:[{action:'*',resource:'*',effect:'ask'},{action:'external_directory',resource:'/home/appuser/.local/share/opencode/tool-output/*',effect:'deny'},{action:'external_directory',resource:'/home/ingenium-opencode/.local/share/opencode/tool-output/*',effect:'deny'}]};
}
export async function runOriginalManagedJobBootstrap({validateOriginalProtectedDeployment,verifierFactory,environment=process.env,stdin=process.stdin,spawn=nodeSpawn}){
 if(typeof validateOriginalProtectedDeployment!=='function'||typeof verifierFactory!=='function')deny();
 const custody=createOriginalJobCustody(),authority=createOriginalJobAuthority({environment});let control,initial,material,broker;
 const current=async()=>{const expected=assertOriginalBootstrapAssignment(await authority.request('bootstrap-assignment'),environment);if(initial&&(hash(expected.binding)!==hash(initial.binding)||hash(expected.staticProfile)!==hash(initial.staticProfile)||expected.agent!==initial.agent||expected.model!==initial.model))deny();if(material)verifyCore126AgentMaterial(material,expected.binding,expected.agent);assertOriginalJobStaticFiles(expected.staticProfile,IMAGE_INPUTS);return expected;};
 const withdraw=async reason=>{
  // Latch and retain local child custody first. Core withdrawal only narrows this original credential/run.
  const stopping=custody.withdraw();const recorded=await authority.request('withdraw',{runId:authority.runId,attemptId:authority.attemptId,reason}).then(()=>true,()=>false);
  void stopping.catch(()=>{});return {withdrawalRecorded:recorded,leaderStopRequested:true,wholeContainerRetired:false};
 };
 try{return await bootstrapCore126Job({
  validateOriginalProtectedDeployment:async()=>{await validateOriginalProtectedDeployment();prepareJobPrivateDirectories();},
  readOriginalJobFrame:async()=>{const frame=await readOriginalJobFrame(stdin);material=frame.agentMaterial;return frame;},
  writeOriginalPrivateCapability:async(path,capability)=>writeOriginalJobPrivate(path,capability),
  fetchOriginalAssignment:async()=>{initial=await current();return initial;},
  writeOriginalPrivateJson:async(path,value)=>writeOriginalJobPrivate(path,value),
  assertOriginalImageIsolation:async({config})=>{await current();if(hash(config)!==hash(core126ClosedJobConfig())||hash(JSON.parse(readFileSync(JOB_CONFIG,'utf8')))!==hash(config))deny();broker=readOriginalProtectedBroker();},
  runOriginalChild:async()=>{
   const frameCapability=readOriginalJobCapability();
   const controller=createOriginalJobControl({capability:frameCapability,identity:{runId:authority.runId,attemptId:authority.attemptId},loadBinding:async()=>{
    if(custody.isWithdrawn())deny();const expected=await current();return freeze({agentName:expected.agent,admission:{...expected.binding,model:expected.model},material,broker,mcpEnvironment:{PATH:'/usr/local/bin:/usr/bin:/bin',INGENIUM_API_URL:environment.INGENIUM_API_URL,INGENIUM_MCP_AUDIENCE:'job-run',INGENIUM_JOB_RUN_ID:authority.runId,INGENIUM_JOB_ATTEMPT_ID:authority.attemptId,INGENIUM_MCP_CREDENTIAL_FILE:'/run/ingenium-runtime/capability',INGENIUM_RUNTIME_CREDENTIAL_FILE:'/run/ingenium-runtime/capability'}});
   },withdraw});
   control=await openOriginalJobControl(controller);
   const run=createManagedJobChild({environment:{...environment,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_CONFIG_DIR:JOB_CONFIG_DIRECTORY,OPENCODE_CONFIG:JOB_CONFIG},spawn,verifierFactory,fetchAssignment:()=>authority.request('assignment'),reportResult:(_identity,result)=>authority.request('result',{attemptId:authority.attemptId,result}),beforeSpawn:()=>custody.assertMaySpawn(),retainChild:proc=>custody.retain(proc)});
   return await run({runId:authority.runId,attemptId:authority.attemptId});
  },
 });}catch(error){await withdraw('CORE126_JOB_PARENT_STOP');throw error;}
 finally{await custody.withdraw();await control?.close();}
}
