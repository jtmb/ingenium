import type {Request,Response,NextFunction} from 'express';
export function provisionWorkspaceRuntimeFromRequestV2(request:Request,selection:unknown):Promise<unknown>;
export function refreshWorkspaceRuntimeFromRequestV2(request:Request,selection:unknown):Promise<unknown>;
export function originalWorkspaceAdmissionV2(selector:unknown):unknown;
export function originalWorkspaceProfileV2(runtimeId:string):unknown;
export function workspaceV2PrivateIngress(request:Request,response:Response,next:NextFunction):void;

export function stopWorkspaceRuntimeFromRequestV2(request:Request,selection:unknown):Promise<unknown>;
export function prepareWorkspaceSuccessorFromRequestV2(request:Request,selection:unknown):unknown;

export function workspaceStartWasNotDispatched(error:unknown,runtimeId:string):boolean;
