import type {Core126AgentMaterial,Core126AgentBinding,Core126AgentConfig} from './core126-agent-material.mjs';
export const JOB_PLUGIN_ID:'ingenium.enforce-job-agent';
export const JOB_BUILTINS:readonly string[];
export const JOB_CONFIG_DIRECTORY:'/run/ingenium-runtime/job/config';
export interface Core126JobSnapshot {agentName:string;admission:Core126AgentBinding & {model:string};material:Core126AgentMaterial;broker:Core126AgentConfig & {id:'ingenium-llm-broker';name:'ingenium-llm-broker'};mcpEnvironment:Record<string,string>}
export interface Core126JobPluginPorts {
 loadOriginalBinding():Promise<Core126JobSnapshot>;
 /** Actual original image/loader proof owner, not a supplied bool/label. */
 assertOriginalIsolation(snapshot:Core126JobSnapshot):Promise<void>;
 assertStaticImageFiles(snapshot:Core126JobSnapshot):Promise<void>;
 /** Original manager admission withdrawal and retained-process custody; qualify actual behavior. */
 revokeOriginalDispatch(admission:Core126JobSnapshot['admission'],reason:string):Promise<void>;
 now?:()=>number;
}
export function core126ClosedJobConfig():Readonly<{plugins:readonly string[];permissions:readonly {action:string;resource:string;effect:'deny'}[];mcp:{servers:Record<string,never>}}>;
/** Actual pinned Promise SDK context is supplied by the original loader. Unknown
 * input here avoids importing a different installed SDK as a false type witness. */
export function createCore126JobAgentPlugin(ports:Core126JobPluginPorts):Readonly<{id:'ingenium.enforce-job-agent';setup(ctx:unknown):Promise<()=>Promise<void>>}>;