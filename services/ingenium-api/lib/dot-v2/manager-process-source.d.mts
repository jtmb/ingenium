declare const originalManagerProcessSource:unique symbol;
export interface OriginalManagerProcessSource {readonly [originalManagerProcessSource]:true;}
export interface ManagerProcessSourceFacts {schemaVersion:1;kind:'original-manager-process-source';pid:number;uid:number;startIdentity:string;entrySha256:string;executableSha256:string;nodeVersion:string;daemonId:string;observedAt:number;expiresAt:number;}
export function captureOriginalManagerProcessSource():Promise<OriginalManagerProcessSource>;
export function readOriginalManagerProcessSource(original:OriginalManagerProcessSource):Readonly<ManagerProcessSourceFacts>;