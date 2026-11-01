import {UUID,hash,originalJsonHash,freeze,hex,imageId,unavailable} from "./core126-image-contract.mjs";
import {validateCore126AgentConfiguration} from "./core126-agent-material.mjs";
const keys=["runId","attemptId","runtimeId","projectId","organizationId","ownerUserId","workspaceId","bindingHash","bindingEpoch","imageId","agentHash","deadlineAt","candidatePurpose","candidateIntentHash","candidateChildId","candidateChildBirthHash"];
const exact=(value,names)=>value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).sort().join("|")===[...names].sort().join("|");
function bound(value,allowModel=false){
 if(allowModel&&value&&Object.hasOwn(value,"model")){if(value.model!=="opencode/qualification-canary")unavailable("candidate-only model");const {model,...rest}=value;value=rest;}
 if(!exact(value,keys)||value.candidatePurpose!=="candidate-inert-v1"||!["runId","attemptId","runtimeId","projectId","organizationId","ownerUserId"].every(k=>UUID.test(value[k]??""))||!["bindingHash","agentHash","candidateIntentHash","candidateChildId","candidateChildBirthHash"].every(k=>hex(value[k]))||!imageId(value.imageId)||!Number.isSafeInteger(value.bindingEpoch)||value.bindingEpoch<0||typeof value.workspaceId!=="string"||!value.workspaceId||value.workspaceId.length>256||value.workspaceId!==value.workspaceId.trim()||/[\u0000-\u001f\u007f]/u.test(value.workspaceId)||!Number.isFinite(Date.parse(value.deadlineAt)))unavailable("candidate-only original material binding");return value;
}
/** Same ordered default-deny configuration checker; distinct purpose/format and
 * original candidate identity. No profileHash or production qualification exists. */
export function verifyCandidateAgentMaterial(material,admission,agentName,now=Date.now()){
 if(!exact(material,["schemaVersion","format","binding","agentName","agentConfig"])||material.schemaVersion!==1||material.format!=="core126-original-candidate-agent-material"||material.agentName!=="qualification"||agentName!=="qualification"||hash(bound(material.binding))!==hash(bound(admission,true))||Date.parse(admission.deadlineAt)<=now||originalJsonHash(validateCore126AgentConfiguration(material.agentConfig))!==admission.agentHash||Buffer.byteLength(JSON.stringify(material))>384*1024)unavailable("candidate-only original agent material");return freeze(structuredClone(material));
}
export function candidateAgentOverlay(material,admission,agentName,now=Date.now()){const checked=verifyCandidateAgentMaterial(material,admission,agentName,now);return freeze({agents:{[agentName]:checked.agentConfig}});}
