import type {Request,RequestHandler} from "express";
import type {OwnerScope,ExecutionBinding} from "../../../../packages/veyra-projects/contracts.js";
import type {NativeWorkspaceTransport} from "./native-transport.mjs";
export function createNativeExecutionHandlers(dependencies:{
  native:NativeWorkspaceTransport;
  resolveScope:(request:Request)=>OwnerScope|null|Promise<OwnerScope|null>;
  resolveContext:(request:Request,scope:OwnerScope)=>Promise<{projectId:string|null;binding:ExecutionBinding}>;
}):Record<"terminalDispatch"|"terminalReceipt"|"terminalRead"|"gitRead"|"gitPreview"|"gitSubmit"|"gitReceipt",RequestHandler>;
