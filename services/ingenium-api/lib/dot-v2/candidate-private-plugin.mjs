import {createOriginalJobAuthority,readOriginalJobCapability} from './job-original-authority.mjs';
import {requestOriginalJobControl} from './job-private-control.mjs';
import {assertOriginalJobStaticFiles,assertJobPrivateTmpfs} from './job-private-files.mjs';
import {readOriginalProtectedBroker} from './job-bootstrap-runtime.mjs';
import {assertCandidateBootstrapAssignment} from './candidate-bootstrap-runtime.mjs';
import {candidateBinding,candidateDenied} from './candidate-carrier.mjs';
import {parseStrictJobJson} from './job-bootstrap-frame.mjs';
import {verifyCandidateAgentMaterial} from '../../../../packages/veyra-operations/core126-candidate-material.mjs';
import {createCore126CandidateJobAgentPlugin} from '../../../../packages/veyra-operations/core126-job-plugin.mjs';
import {IMAGE_INPUTS,hash} from './job-bootstrap-facade.mjs';
/** Executed independently inside the real standalone server. No parent FD assumption. */
export function createOriginalCandidatePrivatePorts({environment=process.env,authority=createOriginalJobAuthority({environment}),readCapability=readOriginalJobCapability,requestControl=requestOriginalJobControl,assertTmpfs=assertJobPrivateTmpfs,assertStatic=assertOriginalJobStaticFiles,readBroker=readOriginalProtectedBroker}={}){
 const raw=environment.INGENIUM_CANDIDATE_ORIGINAL_BINDING;if(typeof raw!=="string"||Buffer.byteLength(raw)>2048||environment.INGENIUM_API_URL!=="http://127.0.0.1:39262/api/v1")candidateDenied();
 const original=candidateBinding(parseStrictJobJson(Buffer.from(raw),2048));
 const identity={runId:authority.runId,attemptId:authority.attemptId};if(identity.runId!==original.runId||identity.attemptId!==original.attemptId)candidateDenied();let latest;
 const independentlyCurrent=async snapshot=>{
  const expected=assertCandidateBootstrapAssignment(await authority.request('bootstrap-assignment'),original,environment);
  const {model,...binding}=snapshot.admission??{};if(hash(expected.binding)!==hash(binding)||model!==expected.model)throw Error('Original JobRun binding changed');
  verifyCandidateAgentMaterial(snapshot.material,expected.binding,expected.agent);assertTmpfs();assertStatic(expected.staticProfile,IMAGE_INPUTS);if(hash(snapshot.broker)!==hash(readBroker())||snapshot.mcpEnvironment?.INGENIUM_API_URL!==environment.INGENIUM_API_URL)throw Error('Original protected job plugin binding changed');latest=expected;
 };
 return {
  async loadOriginalBinding(){const snapshot=await requestControl({capability:readCapability(),identity,operation:'binding'});await independentlyCurrent(snapshot);return snapshot;},
  async assertOriginalIsolation(snapshot){await independentlyCurrent(snapshot);},
  async assertStaticImageFiles(snapshot){if(!latest)throw Error('Original JobRun static profile unavailable');verifyCandidateAgentMaterial(snapshot.material,latest.binding,latest.agent);assertStatic(latest.staticProfile,IMAGE_INPUTS);},
  async revokeOriginalDispatch(_admission,reason){
   // Direct original Core withdrawal is mandatory even if a same-UID socket were replaced.
   const results=await Promise.allSettled([authority.request('withdraw',{...identity,reason}),requestControl({capability:readCapability(),identity,operation:'withdraw',reason})]);
   if(results[0].status!=='fulfilled'||results[1].status!=='fulfilled')throw Error('Original JobRun withdrawal unconfirmed');
  },
 };
}
export function createOriginalCandidatePrivatePlugin(options){return createCore126CandidateJobAgentPlugin(createOriginalCandidatePrivatePorts(options));}
