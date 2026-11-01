import type {Transform} from "node:stream";
export function createCandidateDockerOutput(options:{onUnknown(value:{code:"ORIGINAL_CANDIDATE_ATTACH_UNKNOWN"}):void}):Readonly<{output:Transform;diagnostic():Readonly<{stderrBytes:number;stderrSha256:string;rawBytes:number;unknown:boolean}>}>;
