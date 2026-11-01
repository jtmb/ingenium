import {Transform} from "node:stream";
import {createHash} from "node:crypto";
import {CANDIDATE_FRAME_LIMIT,CANDIDATE_TOTAL_LIMIT,candidateDenied} from "./candidate-carrier.mjs";
/** Tty=false Docker attach stdcopy decoder. Root pipes ONLY its already retained
 * original candidate attach through this decoder; it never opens/reopens a socket,
 * selects a container, replays input or infers retirement from EOF. */
export function createCandidateDockerOutput({onUnknown}){
 let header=Buffer.alloc(0),remaining=0,kind=0,total=0,stderrBytes=0,latched=false;const stderrHash=createHash("sha256");
 const unknown=()=>{if(latched)return;latched=true;onUnknown({code:"ORIGINAL_CANDIDATE_ATTACH_UNKNOWN"});};
 const output=new Transform({readableHighWaterMark:65536,writableHighWaterMark:65536,
  transform(chunk,_encoding,callback){try{const bytes=Buffer.from(chunk);total+=bytes.length;if(total>CANDIDATE_TOTAL_LIMIT)candidateDenied();let at=0;while(at<bytes.length){if(remaining===0){const take=Math.min(8-header.length,bytes.length-at);header=Buffer.concat([header,bytes.subarray(at,at+take)]);at+=take;if(header.length!==8)continue;kind=header[0];if(![1,2].includes(kind)||header[1]||header[2]||header[3])candidateDenied();remaining=header.readUInt32BE(4);header=Buffer.alloc(0);if(remaining>CANDIDATE_FRAME_LIMIT)candidateDenied();if(remaining===0)continue;}
 const take=Math.min(remaining,bytes.length-at),part=bytes.subarray(at,at+take);at+=take;remaining-=take;
 if(kind===1)this.push(part);else{stderrBytes+=part.length;if(stderrBytes>1024*1024)candidateDenied();stderrHash.update(part);}
 }callback();}catch(error){unknown();callback(error);}},
  flush(callback){unknown();if(header.length||remaining){callback(Error("Original candidate Docker attach truncated"));return;}callback();},
  destroy(error,callback){if(error)unknown();callback(error);},
 });
 return Object.freeze({output,diagnostic:()=>Object.freeze({stderrBytes,stderrSha256:stderrHash.copy().digest("hex"),rawBytes:total,unknown:latched})});
}
