import {timingSafeEqual} from "node:crypto";
import {createServer,request as httpRequest} from "node:http";
import {chmodSync,lstatSync,realpathSync} from "node:fs";
import {parseStrictJobJson} from "./job-bootstrap-frame.mjs";
export const JOB_CONTROL_SOCKET="/run/ingenium-runtime/job/control.sock";
const deny=()=>{throw Error("Original JobRun private control denied");};
export function createOriginalJobCustody({setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let proc,closed=false,latched=false,join,resolveJoin,stopping;
 return Object.freeze({assertMaySpawn(){if(latched||proc)deny();},retain(child){if(latched||proc)deny();proc=child;join=new Promise(resolve=>{resolveJoin=resolve;});child.once("close",()=>{closed=true;resolveJoin();});},isWithdrawn:()=>latched,
  withdraw(){latched=true;if(stopping)return stopping;stopping=(async()=>{if(!proc)return {leaderClosed:true,wholeContainerRetired:false};if(!closed){proc.kill("SIGTERM");const timer=setTimer(()=>{if(!closed)proc.kill("SIGKILL");},5000);try{await join;}finally{clearTimer(timer);}}return {leaderClosed:closed,wholeContainerRetired:false};})();return stopping;}
 });
}
export function createOriginalJobControl({capability,identity,loadBinding,withdraw}){
 let latched=false,withdrawal;
 const authorized=header=>{if(typeof header!=="string"||!header.startsWith("Bearer "))deny();const a=Buffer.from(header.slice(7)),b=Buffer.from(capability);if(a.length!==b.length||!timingSafeEqual(a,b))deny();};
 return Object.freeze({async dispatch({path,method,headers,body}){
  authorized(headers.authorization);if(method!=="POST"||headers['x-ingenium-audience']!=="job-run"||headers['x-ingenium-job-attempt']!==identity.attemptId||headers.cookie!==undefined||headers.origin!==undefined||!body||typeof body!=="object"||Array.isArray(body)||body.runId!==identity.runId||body.attemptId!==identity.attemptId)deny();
  if(path==='/binding'){if(latched||Object.keys(body).sort().join('|')!=='attemptId|runId')deny();return await loadBinding();}
  if(path==='/withdraw'){if(Object.keys(body).sort().join('|')!=='attemptId|reason|runId'||!['CORE126_JOB_ENFORCEMENT_LOST','CORE126_JOB_PLUGIN_UNLOADED','CORE126_JOB_PARENT_STOP'].includes(body.reason))deny();latched=true;withdrawal??=Promise.resolve().then(()=>withdraw(body.reason));return await withdrawal;}
  deny();
 }});
}
/** Exact fixed Unix socket, same original capability; no inherited descriptor or new token authority. */
export async function openOriginalJobControl(control){
 const server=createServer(async(req,res)=>{try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2048)deny();chunks.push(chunk);}const bodyText=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  const body=parseStrictJobJson(Buffer.from(bodyText),2048);
  const data=await control.dispatch({path:req.url,method:req.method,headers:req.headers,body});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({data}));
 }catch{res.writeHead(403,{'Content-Type':'application/json'}).end('{"error":{"code":"JOB_PRIVATE_CONTROL_DENIED"}}');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(JOB_CONTROL_SOCKET,()=>{server.off('error',reject);resolve();});});
 chmodSync(JOB_CONTROL_SOCKET,0o600);const socketStat=lstatSync(JOB_CONTROL_SOCKET);if(!socketStat.isSocket()||socketStat.uid!==process.getuid?.()||(socketStat.mode&0o777)!==0o600||realpathSync(JOB_CONTROL_SOCKET)!==JOB_CONTROL_SOCKET){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));deny();}
 return {async close(){server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}};
}
export async function requestOriginalJobControl({capability,identity,operation,reason}){
 if(!['binding','withdraw'].includes(operation))deny();const socketStat=lstatSync(JOB_CONTROL_SOCKET);if(!socketStat.isSocket()||socketStat.uid!==process.getuid?.()||(socketStat.mode&0o777)!==0o600||realpathSync(JOB_CONTROL_SOCKET)!==JOB_CONTROL_SOCKET)deny();const body=JSON.stringify({...identity,...(reason===undefined?{}:{reason})});
 return await new Promise((resolve,reject)=>{const req=httpRequest({socketPath:JOB_CONTROL_SOCKET,path:'/'+operation,method:'POST',headers:{Authorization:`Bearer ${capability}`,'X-Ingenium-Audience':'job-run','X-Ingenium-Job-Attempt':identity.attemptId,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:15000},res=>{let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>512*1024){res.destroy();reject(Error('Original JobRun private control denied'));}else chunks.push(chunk);});res.on('error',()=>reject(Error('Original JobRun private control denied')));res.on('end',()=>{if(res.statusCode!==200)return reject(Error('Original JobRun private control denied'));try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).data);}catch{reject(Error('Original JobRun private control denied'));}});});req.on('timeout',()=>req.destroy(Error('Original JobRun private control denied')));req.on('error',()=>reject(Error('Original JobRun private control denied')));req.end(body);});
}
