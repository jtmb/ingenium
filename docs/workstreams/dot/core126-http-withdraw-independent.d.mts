import type {Core126ManagerGuard,Core126Owner,ManagedCredentialPorts,ClosedToolAuthorizer,ExistingToolDispatcher,ExistingToolCatalog,Core126Handlers,Core126OwnerPorts,ManagedJobCredential} from "./managed-job-contracts.mjs";
import type {mcpAuthorizationPolicy} from "ingenium-core";
export declare function createCore126ManagerGuard(ports:{loadToken():string}):Core126ManagerGuard;
export declare function createCore126Handlers(ports:{owner:Core126Owner;managerGuard:Core126ManagerGuard;credentials:ManagedCredentialPorts;authorizeTool?:ClosedToolAuthorizer;dispatchExistingTool?:ExistingToolDispatcher;listAuthorizedTools?:(credential:ManagedJobCredential)=>unknown|Promise<unknown>}):Core126Handlers;
export declare function createCore126ToolAuthorizer(ports:{credentials:ManagedCredentialPorts;mcpAuthorizationPolicy:Pick<typeof mcpAuthorizationPolicy,"explicitMcpAuthorizationPolicy">;authorization:Core126OwnerPorts["authorization"];jobs:Core126OwnerPorts["jobs"];toolCatalog?:ExistingToolCatalog}):ClosedToolAuthorizer;
export declare function createCore126WithdrawalHandler(ports:{credentials:Pick<ManagedCredentialPorts,"withdrawManagedJobDispatch">}):Core126Handlers["runtime"];
