/** Private paired Native HTTPS client. It is never a router, proxy or renderer API. */
import https from "node:https";
import tls from "node:tls";
import {createHash} from "node:crypto";
import type {NativePairOriginal} from "./paired-native-proof.js";
export type PairedNativeCredential=Readonly<{endpoint:string;certificatePem:string;certificateSha256:string;token:string;original:NativePairOriginal}>;
const id=(s:string)=>/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(s);
export function createPairedNativeReader(credential:PairedNativeCredential){
 const origin=new URL(credential.endpoint);
 if(origin.protocol!=="https:"||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash||
 !/^[a-f0-9]{64}$/.test(credential.certificateSha256)||!/^[a-f0-9]{64}$/.test(credential.token))throw new Error("NATIVE_CUSTODY_INVALID");
 const original=structuredClone(credential.original),pin=credential.certificateSha256,token=credential.token,certificatePem=credential.certificatePem;
 function read(operation:"context"|"original",operationId?:string,payloadHash?:string):Promise<unknown>{
  if(!id(original.enrollmentRequestId)||!id(original.actorId)||!id(original.installationId)||operation==="original"&&(!operationId||!id(operationId)||!payloadHash||!/^[a-f0-9]{64}$/.test(payloadHash)))throw new Error("NATIVE_SELECTOR_INVALID");
  const path="/remote/v1/node-hosted/enrollments/"+encodeURIComponent(original.enrollmentRequestId)+(operation==="context"?"/context":"/originals/"+encodeURIComponent(operationId!));
  const url=new URL(path,origin);url.searchParams.set("actor_id",original.actorId);url.searchParams.set("installation_id",original.installationId);
  if(operation==="original")url.searchParams.set("payload_hash",payloadHash!);
  return new Promise((resolve,reject)=>{
   let settled=false;const fail=()=>{if(!settled){settled=true;reject(new Error("NATIVE_OWNER_UNAVAILABLE"));}};
   const request=https.request(url,{method:"GET",agent:false,ca:certificatePem,rejectUnauthorized:true,
    checkServerIdentity:(host,certificate)=>{if(!certificate.raw||createHash("sha256").update(certificate.raw).digest("hex")!==pin)return new Error("NATIVE_PIN_REFUSED");return tls.checkServerIdentity(host,certificate);},
    headers:{Authorization:"Bearer "+token,Accept:"application/json","Cache-Control":"no-store"}},response=>{
     const parts:Buffer[]=[];let count=0;
     if(response.statusCode!==200){response.destroy();request.destroy();fail();return;}
     response.on("data",part=>{const bytes=Buffer.from(part);count+=bytes.length;if(count>128*1024){response.destroy();request.destroy();fail();}else parts.push(bytes);});
     response.on("error",fail);response.on("aborted",fail);
     response.on("end",()=>{if(settled)return;try{const value=JSON.parse(Buffer.concat(parts).toString("utf8"));settled=true;resolve(value);}catch{fail();}});
    });
   // Absolute timeout includes DNS/TLS/body; no redirects, proxy, retry or fallback.
   const timer=setTimeout(()=>{request.destroy();fail();},2000);timer.unref();
   request.on("close",()=>clearTimeout(timer));request.on("error",fail);request.end();
  });
 }
 return Object.freeze({original,readContext:()=>read("context"),readOriginal:(operationId:string,payloadHash:string)=>read("original",operationId,payloadHash)});
}
