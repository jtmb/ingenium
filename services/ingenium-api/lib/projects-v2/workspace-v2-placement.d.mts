import type {Request} from 'express';
import type {RequestExecutionFacts} from './request-execution-owner.mjs';
export function qualifyWorkspaceV2Placement(runtime:unknown,workspace:unknown,original:unknown,definition:unknown,proof:unknown,installationId:string):RequestExecutionFacts;
export function withManagedWorkspaceV2Placement<T>(request:Request,selection:unknown,work:()=>T|Promise<T>):Promise<T>;
export function resolveCurrentWorkspaceV2Execution(request:Request,selection:unknown):RequestExecutionFacts;
