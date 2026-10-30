export const MAX_JOB_FRAME_BYTES=384*1024+256;
const deny=()=>{throw Error("Original JobRun manager frame unavailable");};
/** Strict JSON, including duplicate decoded keys at every depth. No reviver or last-key-wins parsing. */
export function parseStrictJobJson(bytes,maxBytes=MAX_JOB_FRAME_BYTES){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>maxBytes)deny();let s;try{s=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{deny();}let at=0;
 const ws=()=>{while(/[ \t\r\n]/.test(s[at]??"_")&&at<s.length)at++;};
 const string=()=>{const begin=at++;while(at<s.length){const c=s[at++];if(c==='"'){try{return JSON.parse(s.slice(begin,at));}catch{deny();}}if(c==='\\')at++;}deny();};
 function value(depth){if(depth>64)deny();ws();const c=s[at];if(c==='"')return string();if(c==='{'){at++;ws();const out={},keys=new Set();if(s[at]==='}'){at++;return out;}while(true){ws();if(s[at]!=='"')deny();const key=string();if(keys.has(key)||['__proto__','constructor','prototype'].includes(key))deny();keys.add(key);ws();if(s[at++]!==':')deny();out[key]=value(depth+1);ws();const sep=s[at++];if(sep==='}')return out;if(sep!==',')deny();}}if(c==='['){at++;ws();const out=[];if(s[at]===']'){at++;return out;}while(true){out.push(value(depth+1));ws();const sep=s[at++];if(sep===']')return out;if(sep!==',')deny();}}const match=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(s.slice(at));if(!match)deny();at+=match[0].length;const v=JSON.parse(match[0]);if(typeof v==='number'&&!Number.isFinite(v))deny();return v;}
 const parsed=value(0);ws();if(at!==s.length)deny();return parsed;
}
export function parseOriginalJobFrame(bytes){if(bytes.at(-1)!==10)deny();const parsed=parseStrictJobJson(bytes);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||Object.keys(parsed).sort().join('|')!=='agentMaterial|capability'||typeof parsed.capability!=='string'||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(parsed.capability))deny();return parsed;}
export async function readOriginalJobFrame(stream){let size=0;const chunks=[];for await(const chunk of stream){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>MAX_JOB_FRAME_BYTES)throw Error("Original JobRun manager frame unavailable");chunks.push(bytes);}return parseOriginalJobFrame(Buffer.concat(chunks));}
