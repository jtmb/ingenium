import {createOriginalJobAuthority,readOriginalJobCapability} from './job-original-authority.mjs';
import {requestOriginalJobControl} from './job-private-control.mjs';
import {assertOriginalJobStaticFiles,assertJobPrivateTmpfs} from './job-private-files.mjs';
import {assertOriginalBootstrapAssignment,readOriginalProtectedBroker} from './job-bootstrap-runtime.mjs';
import {verifyCore126AgentMaterial,IMAGE_INPUTS,hash,createCore126JobAgentPlugin} from './job-bootstrap-facade.mjs';
/** Executed independently inside the real standalone server. No parent FD assumption. */
export function createOriginalPrivateJobPorts({environment=process.env,authority=createOriginalJobAuthority({environment}),readCapability=readOriginalJobCapability,requestControl=requestOriginalJobControl,assertTmpfs=assertJobPrivateTmpfs,assertStatic=assertOriginalJobStaticFiles,readBroker=readOriginalProtectedBroker}={}){
 const identity={runId:authority.runId,attemptId:authority.attemptId};let latest;
 const independentlyCurrent=async snapshot=>{
  const expected=assertOriginalBootstrapAssignment(await authority.request('bootstrap-assignment'),environment);
  const {model,...binding}=snapshot.admission??{};if(hash(expected.binding)!==hash(binding)||model!==expected.model)throw Error('Original JobRun binding changed');
  verifyCore126AgentMaterial(snapshot.material,expected.binding,expected.agent);assertTmpfs();assertStatic(expected.staticProfile,IMAGE_INPUTS);if(hash(snapshot.broker)!==hash(readBroker())||snapshot.mcpEnvironment?.INGENIUM_API_URL!==environment.INGENIUM_API_URL)throw Error('Original protected job plugin binding changed');latest=expected;
 };
 return {
  async loadOriginalBinding(){const snapshot=await requestControl({capability:readCapability(),identity,operation:'binding'});await independentlyCurrent(snapshot);return snapshot;},
  async assertOriginalIsolation(snapshot){await independentlyCurrent(snapshot);},
  async assertStaticImageFiles(snapshot){if(!latest)throw Error('Original JobRun static profile unavailable');verifyCore126AgentMaterial(snapshot.material,latest.binding,latest.agent);assertStatic(latest.staticProfile,IMAGE_INPUTS);},
  async revokeOriginalDispatch(_admission,reason){
   // Direct original Core withdrawal is mandatory even if a same-UID socket were replaced.
   const results=await Promise.allSettled([authority.request('withdraw',{...identity,reason}),requestControl({capability:readCapability(),identity,operation:'withdraw',reason})]);
   if(results[0].status!=='fulfilled'||results[1].status!=='fulfilled')throw Error('Original JobRun withdrawal unconfirmed');
  },
 };
}
export function createOriginalPrivateJobPlugin(options){return createCore126JobAgentPlugin(createOriginalPrivateJobPorts(options));}

