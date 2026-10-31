export function workspaceDocker(method:string,path:string,body?:unknown,limit?:number):Promise<{status:number;bytes:Buffer;request:unknown;response:unknown}>;
export function workspaceDockerJson(method:string,path:string,body?:unknown,status?:number):Promise<{status:number;bytes:Buffer;value:unknown;request:unknown;response:unknown}>;
export function joinWorkspaceAttach(containerId:string,capability:unknown,expected:unknown):Promise<unknown>;
export function requireRetainedWorkspaceAttach(containerId:string):unknown;
