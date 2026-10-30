import type {Core126AgentBinding} from './core126-agent-material.mjs';
export interface Core126JobBootstrapPorts {
 readOriginalJobFrame(limit:{maxBytes:number}):Promise<{capability:string;agentMaterial:unknown}>;
 validateOriginalProtectedDeployment():Promise<void>;
 writeOriginalPrivateCapability(path:'/run/ingenium-runtime/capability',capability:string):Promise<void>;
 fetchOriginalAssignment():Promise<{binding:Core126AgentBinding;agent:string}>;
 writeOriginalPrivateJson(path:string,value:unknown):Promise<void>;
 assertOriginalImageIsolation(input:unknown):Promise<void>;
 runOriginalChild(input:{environment:Readonly<Record<string,string>>;originalBinding:Core126AgentBinding}):Promise<number>;
 now?:()=>number;
}
/** Root's private wrapper reuses its original token/frame/file/API/child owners. */
export function bootstrapCore126Job(ports:Core126JobBootstrapPorts):Promise<number>;