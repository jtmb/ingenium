import {mcpToolStates,projects} from "ingenium-core";
import {createCore126Broker} from "./core126-broker.mjs";
import type {Core126Owner,ClosedToolAuthorizer} from "./managed-job-contracts.mjs";
/** Concrete original catalog and operation composition; callers cannot supply a substitute principal. */
export function createActualCore126Broker(owner:Core126Owner,authorizeTool:ClosedToolAuthorizer){
 return createCore126Broker({owner,authorizeTool,toolStates:mcpToolStates,projects});
}
export const actualManagedJobToolCatalog={getTool(name:string){return mcpToolStates.getAllTools().get(name);}};
