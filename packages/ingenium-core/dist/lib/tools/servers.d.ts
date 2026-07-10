import { Server } from "../schema.js";
export declare function listServers(projectId: string): Server[];
export declare function registerServer(projectId: string, name: string, command: string, args?: string, env?: string): Server;
export declare function updateServer(projectId: string, name: string, fields: {
    running?: number;
}): void;
export declare function removeServer(projectId: string, name: string): void;
//# sourceMappingURL=servers.d.ts.map