import type {mcpToolStates,projects} from "ingenium-core";
import type {Core126Owner,ClosedToolAuthorizer,ManagedJobCredential,ClosedJobToolAuthorization} from "./managed-job-contracts.mjs";
export interface ManagedJobToolDescription {name:string;description:string;inputSchema:{type:"object";properties:{name:{type:"string"}};required:readonly string[];additionalProperties:false};}
export declare const projectDetailSchema:ManagedJobToolDescription["inputSchema"];
export declare function createCore126Broker(ports:{owner:Core126Owner;authorizeTool:ClosedToolAuthorizer;toolStates:Pick<typeof mcpToolStates,"getAllTools"|"getToolState">;projects:Pick<typeof projects,"getProjectById"|"getProjectDetail">}):{
 toolCatalog:{getTool(name:string):mcpToolStates.McpToolCatalogEntry|undefined};
 list(credential:ManagedJobCredential):ManagedJobToolDescription[];
 dispatch(authorized:ClosedJobToolAuthorization,input:unknown,credential:ManagedJobCredential):Promise<{content:[{type:"text";text:string}]}>;
};
