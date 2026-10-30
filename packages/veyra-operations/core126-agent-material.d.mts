import type {Core126ImageAdmission} from './core126-image-owner.mjs';
export const JOB_CONFIG:string,JOB_AGENT_PLUGIN:string,BROKER_PLUGIN:string,BROKER_PROFILE:string,JOB_MCP:string;
export interface Core126AgentConfig {description:string;mode:'primary'|'subagent'|'all';system:string;hidden:boolean;permissions:{action:string;resource:string;effect:'allow'|'deny'|'ask'}[]}
export type Core126AgentBinding=Pick<Core126ImageAdmission,'runId'|'runtimeId'|'projectId'|'organizationId'|'ownerUserId'|'workspaceId'|'bindingHash'|'bindingEpoch'|'profileHash'|'imageId'|'agentHash'|'deadlineAt'> & {attemptId:string};
/** Private one-use original Core handoff material; never persist it as image evidence/logs. */
export interface Core126AgentMaterial {readonly schemaVersion:1;readonly format:'core126-original-agent-material';readonly binding:Readonly<Core126AgentBinding>;readonly agentName:string;readonly agentConfig:Readonly<Core126AgentConfig>}
export interface Core126StaticJobProfile {imageId:string;jobConfigSha256:string;brokerProfileSha256:string;brokerPluginSha256:string;jobAgentPluginSha256:string}
/** Actual native OpenCode merged registry/config observation, from the protected plugin.
 * Caller-supplied JSON/labels/booleans are never an implementation of this port. */
export interface Core126EffectiveJobProfile {
 agent:Core126AgentConfig & {id:string;name:string;disabled?:boolean;model?:string;steps?:number;request?:unknown};
 jobConfigSha256:string;brokerProfileSha256:string;brokerPluginSha256:string;jobAgentPluginSha256:string;
 plugins:string[];genericBootstrapRequests:number;configAuthority:'original-manager-job-only';
 mcpServers:{ingenium:{type:'local';command:string[];disabled:false;audience:'job-run';runId:string;attemptId:string;credentialFile:string}};
 reservedBroker:{id:'ingenium-llm-broker';hidden:true;mode:'subagent';profileSha256:string;enforcementPluginSha256:string};
}
export function projectCore126AgentMaterial(input:{admission:Core126AgentBinding;agentName:string;agentConfig:Core126AgentConfig},now?:number):Core126AgentMaterial;
export function verifyCore126AgentMaterial(material:unknown,admission:Core126AgentBinding,expectedAgentName:string,now?:number):Core126AgentMaterial;
export function core126AgentOverlay(material:unknown,admission:Core126AgentBinding,agentName:string,now?:number):Readonly<{agents:Record<string,Readonly<Core126AgentConfig>>}>;
export function assertCore126EffectiveJobProfile(input:{material:unknown;admission:Core126AgentBinding;agentName:string;effective:Core126EffectiveJobProfile;staticProfile:Core126StaticJobProfile},now?:number):true;