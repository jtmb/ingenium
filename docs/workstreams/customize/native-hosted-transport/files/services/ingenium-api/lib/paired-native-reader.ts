/** Private typed Native pairing/read client; never a renderer URL/token proxy. */
import https from "node:https";import tls from "node:tls";import {createHash} from "node:crypto";
import {contextProof,type NativePairOriginal} from "./paired-native-proof.js";
export type TransportTrust=Readonly<{endpoint:string;certificatePem:string;certificateSha256:string}>;
export type Preparation=TransportTrust&Readonly<{schemaVersion:1;stage:"preparation";enrollmentRequestId:string;pairingCode:string;expectedAuthorityId:string}>;
export type Redeemed=TransportTrust&Readonly<{schemaVersion:1;stage:"redeemed";enrollmentRequestId:string;actorId:string;installationId:string;hostedProjectId:string;token:string;authorityId:string;serviceInstanceId:string;grantId:string}>;
export type PairedNativeCredential=TransportTrust&Readonly<{token:string;original:NativePairOriginal}>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const id=(s:unknown):s is string=>typeof s==="string"&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(s);
function invalid():never{throw new Error("NATIVE_CUSTODY_INVALID");}
function origin(t:TransportTrust){let u:URL;try{u=new URL(t.endpoint);}catch{return invalid();}if(u.protocol!=="https:"||u.username||u.password||u.pathname!=="/"||u.search||u.hash||typeof t.certificatePem!=="string"||t.certificatePem.length>1024*1024||!/^[a-f0-9]{64}$/.test(t.certificateSha256))return invalid();return u;}
export function decodePreparation(value:unknown,enrollmentRequestId:string):Preparation{
 if(!object(value)||Object.keys(value).sort().join(",")!=="certificatePem,certificateSha256,endpoint,enrollmentRequestId,expectedAuthorityId,pairingCode,schemaVersion,stage"||
 value.schemaVersion!==1||value.stage!=="preparation"||value.enrollmentRequestId!==enrollmentRequestId||!id(value.expectedAuthorityId)||typeof value.pairingCode!=="string"||!/^[a-f0-9]{64}$/.test(value.pairingCode))return invalid();
 const result=value as Preparation;origin(result);return result;
}
type Reply={body:unknown;cookies:readonly string[]};
function request(trust:TransportTrust,path:string,method:"GET"|"POST",query:Record<string,string>,token?:string,body?:unknown):Promise<Reply>{
 const host=origin(trust),pin=trust.certificateSha256,ca=trust.certificatePem,url=new URL(path,host);
 for(const[k,v]of Object.entries(query))url.searchParams.set(k,v);
 const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body),"utf8");
 return new Promise((resolve,reject)=>{
  let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
  const fail=()=>{if(!settled){settled=true;if(timer)clearTimeout(timer);reject(new Error("NATIVE_OWNER_UNAVAILABLE"));}};
  const call=https.request(url,{method,agent:false,ca,rejectUnauthorized:true,
   checkServerIdentity:(name,certificate)=>{if(!certificate.raw||createHash("sha256").update(certificate.raw).digest("hex")!==pin)return new Error("NATIVE_PIN_REFUSED");return tls.checkServerIdentity(name,certificate);},
   headers:{Accept:"application/json","Cache-Control":"no-store",...(token?{Authorization:"Bearer "+token}:{}),...(payload?{"Content-Type":"application/json","Content-Length":String(payload.length)}:{})}},response=>{
    const chunks:Buffer[]=[];let count=0;
    if(response.statusCode!==200){response.destroy();call.destroy();fail();return;}
    response.on("data",part=>{const bytes=Buffer.from(part);count+=bytes.length;if(count>128*1024){response.destroy();call.destroy();fail();}else chunks.push(bytes);});
    response.on("error",fail);response.on("aborted",fail);response.on("end",()=>{if(settled)return;try{const parsed=JSON.parse(Buffer.concat(chunks).toString("utf8"));settled=true;if(timer)clearTimeout(timer);resolve({body:parsed,cookies:response.headers["set-cookie"]??[]});}catch{fail();}});
   });
  timer=setTimeout(()=>{call.destroy();fail();},2000);timer.unref();call.on("error",fail);call.on("close",()=>{if(!settled)fail();});call.end(payload);
 });
}
function pairingCookie(headers:readonly string[]):string{
 let result:string|undefined;
 for(const raw of headers){const first=raw.split(";")[0];if(!first||!first.startsWith("veyra_remote="))continue;
  const value=first.slice("veyra_remote=".length),attrs=raw.split(";").slice(1).map(v=>v.trim().toLowerCase());
  if(result||!/^[a-f0-9]{64}$/.test(value)||!["secure","httponly","samesite=strict","path=/remote/"].every(v=>attrs.includes(v))||attrs.some(v=>v.startsWith("domain=")))return invalid();result=value;}
 return result??invalid();
}
async function readContext(credential:TransportTrust&{token:string},actorId:string,installationId:string,enrollmentRequestId:string):Promise<unknown>{
 const path="/remote/v1/node-hosted/enrollments/"+encodeURIComponent(enrollmentRequestId)+"/context";
 return (await request(credential,path,"GET",{actor_id:actorId,installation_id:installationId},credential.token)).body;
}
/** Recover a retained encrypted redemption by READ only. This never submits a pair code. */
export async function verifyRedeemed(credential:Redeemed):Promise<PairedNativeCredential>{
 origin(credential);if(!id(credential.actorId)||!id(credential.installationId)||!id(credential.enrollmentRequestId)||!id(credential.grantId)||!/^[a-f0-9]{64}$/.test(credential.token))return invalid();
 const value=await readContext(credential,credential.actorId,credential.installationId,credential.enrollmentRequestId);
 if(!object(value)||!object(value.native_owner)||!object(value.grant)||value.native_authority_id!==credential.authorityId||value.grant.id!==credential.grantId||
 value.native_owner.service_instance_id!==credential.serviceInstanceId||typeof value.native_owner.library_id!=="string"||!Number.isSafeInteger(value.grant.revision)||(value.grant.revision as number)<1)return invalid();
 const owner=value.native_owner;
 if(owner.project!==null&&(!object(owner.project)||!id(owner.project.id)||!Number.isSafeInteger(owner.project.revision)||(owner.project.revision as number)<0||owner.project.archived!==false))return invalid();
 const original:NativePairOriginal={actorId:credential.actorId,installationId:credential.installationId,enrollmentRequestId:credential.enrollmentRequestId,hostedProjectId:credential.hostedProjectId,authorityId:credential.authorityId,grantId:credential.grantId,grantRevision:value.grant.revision as number,
  nativeOwner:{library_id:owner.library_id as string,service_instance_id:owner.service_instance_id as string,project:owner.project as Record<string,unknown>|null}};
 contextProof(value,original);
 return {endpoint:credential.endpoint,certificatePem:credential.certificatePem,certificateSha256:credential.certificateSha256,token:credential.token,original};
}
/** Only the original inserted caller executes this. Persist the real cookie BEFORE the next network read. */
export async function redeemNativePreparation(preparation:Preparation,actorId:string,installationId:string,hostedProjectId:string,retain:(value:Redeemed)=>void):Promise<PairedNativeCredential>{
 if(!id(actorId)||!id(installationId)||!id(hostedProjectId))return invalid();
 const response=await request(preparation,"/remote/v1/pair","POST",{},undefined,{code:preparation.pairingCode});
 const value=response.body;
 if(!object(value)||value.authority_id!==preparation.expectedAuthorityId||!id(value.service_instance)||!id(value.grant_id))return invalid();
 const redeemed:Redeemed={schemaVersion:1,stage:"redeemed",endpoint:preparation.endpoint,certificatePem:preparation.certificatePem,certificateSha256:preparation.certificateSha256,
  enrollmentRequestId:preparation.enrollmentRequestId,actorId,installationId,hostedProjectId,token:pairingCookie(response.cookies),authorityId:value.authority_id as string,serviceInstanceId:value.service_instance,grantId:value.grant_id};
 retain(redeemed);return verifyRedeemed(redeemed);
}
export function createPairedNativeReader(credential:PairedNativeCredential){
 origin(credential);if(!/^[a-f0-9]{64}$/.test(credential.token))return invalid();
 const original=structuredClone(credential.original),trust={endpoint:credential.endpoint,certificatePem:credential.certificatePem,certificateSha256:credential.certificateSha256},token=credential.token;
 return Object.freeze({original,
  readContext:()=>readContext({...trust,token},original.actorId,original.installationId,original.enrollmentRequestId),
  async readRetirement(){
   return (await request(trust,"/remote/v1/node-hosted/enrollments/"+encodeURIComponent(original.enrollmentRequestId)+"/retirement","GET",{actor_id:original.actorId,installation_id:original.installationId},token)).body;
  },
  async readOriginal(operationId:string,payloadHash:string){
   if(!id(operationId)||!/^[a-f0-9]{64}$/.test(payloadHash))return invalid();
   const path="/remote/v1/node-hosted/enrollments/"+encodeURIComponent(original.enrollmentRequestId)+"/originals/"+encodeURIComponent(operationId);
   return (await request(trust,path,"GET",{actor_id:original.actorId,installation_id:original.installationId,payload_hash:payloadHash},token)).body;
  }});
}
