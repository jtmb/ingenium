export function validateWorkspaceGatewaySessionV2(input:unknown):Promise<{backendName:string;session:{expiresAt:string;launcherOrigin:string};workspaceV2AuthHeader:string}|undefined>;

export function recordWorkspaceGatewayActivityV2(input:unknown,idleLeaseMs:number):Promise<{accepted:true}|undefined>;
