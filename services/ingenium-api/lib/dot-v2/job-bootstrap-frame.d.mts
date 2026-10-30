export const MAX_JOB_FRAME_BYTES:number;
export interface OriginalJobFrame {capability:string;agentMaterial:unknown}
export function parseStrictJobJson(bytes:Uint8Array,maxBytes?:number):unknown;
export function parseOriginalJobFrame(bytes:Uint8Array):OriginalJobFrame;
export function readOriginalJobFrame(stream:AsyncIterable<Uint8Array|string>):Promise<OriginalJobFrame>;