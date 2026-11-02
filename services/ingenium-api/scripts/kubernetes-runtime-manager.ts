import {createServer,type IncomingMessage} from "node:http";
import {timingSafeEqual} from "node:crypto";
import {pathToFileURL} from "node:url";
import {loadManagerToken} from "../lib/runtime-manager-auth.js";
import {parseStrictJobJson} from "../lib/dot-v2/job-bootstrap-frame.mjs";
import {KubernetesWorkspaceManager} from "../lib/kubernetes/workspace-manager.js";

async function body(request:IncomingMessage):Promise<Record<string,unknown>>{
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>65536)throw Error("KUBERNETES_MANAGER_BODY_BOUND");chunks.push(Buffer.from(chunk));}
  const bytes=Buffer.concat(chunks);
  try{const value=parseStrictJobJson(bytes,65536);if(!value||typeof value!=="object"||Array.isArray(value))throw Error("KUBERNETES_MANAGER_BODY");return value as Record<string,unknown>;}
  finally{bytes.fill(0);}
}
export function startKubernetesRuntimeManager(){
  const manager=new KubernetesWorkspaceManager(),token=loadManagerToken(),port=Number(process.env.INGENIUM_RUNTIME_MANAGER_PORT);
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error("KUBERNETES_MANAGER_PORT");
  const server=createServer(async(request,response)=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),42000);timeout.unref();
    const disconnect=()=>{if(!response.writableFinished)controller.abort();};request.once("aborted",disconnect);response.once("close",disconnect);
    try{
      response.setHeader("Content-Type","application/json");response.setHeader("Cache-Control","no-store");
      const expected="Bearer "+token,authorization=request.headers.authorization;
      if(request.headers.cookie!==undefined||request.headers.origin!==undefined||typeof authorization!=="string"||Buffer.byteLength(authorization)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(authorization),Buffer.from(expected))) {response.writeHead(401).end(JSON.stringify({error:{code:"UNAUTHORIZED"}}));return;}
      const url=new URL(request.url??"/","http://runtime-manager.invalid");
      if(url.search||url.hash)throw Error("KUBERNETES_MANAGER_PATH");
      if(request.method==="GET"&&url.pathname==="/health"){response.writeHead(200).end(JSON.stringify({data:{backendKind:"kubernetes",configured:true}}));return;}
      let data:unknown;
      if(request.method==="POST"&&url.pathname==="/v2/workspace-mappings"){
        if(request.headers["content-type"]!=="application/json")throw Error("KUBERNETES_MANAGER_CONTENT_TYPE");
        data={workspaces:await manager.registrationOffers(await body(request),controller.signal)};
      }else if(request.method==="POST"&&url.pathname==="/v2/workspace-runtimes/preflight"){
        if(request.headers["content-type"]!=="application/json")throw Error("KUBERNETES_MANAGER_CONTENT_TYPE");
        data=await manager.preflight(await body(request),controller.signal);
      }else if(request.method==="POST"&&url.pathname==="/v2/workspace-runtimes"){
        if(request.headers["content-type"]!=="application/json")throw Error("KUBERNETES_MANAGER_CONTENT_TYPE");
        data=await manager.provision(await body(request),controller.signal);
      }else{
        const match=/^\/v2\/workspace-runtimes\/([a-f0-9-]{36})\/(placement|stop|finish-retirement|failed-retirement)$/.exec(url.pathname);
        if(!match){response.writeHead(404).end(JSON.stringify({error:{code:"NOT_FOUND"}}));return;}
        if(request.method==="GET"&&match[2]==="placement")data=await manager.placement(match[1]!,controller.signal);
        else if(request.method==="POST"&&(match[2]==="stop"||match[2]==="finish-retirement"||match[2]==="failed-retirement")){
          if(request.headers["content-type"]!=="application/json"||Object.keys(await body(request)).length)throw Error("KUBERNETES_MANAGER_STOP_BODY");
          data=match[2]==="failed-retirement"?await manager.failedRetirement(match[1]!,controller.signal):match[2]==="stop"?await manager.stop(match[1]!,controller.signal):await manager.finishRetirement(match[1]!,controller.signal);
        }else{response.writeHead(405).end(JSON.stringify({error:{code:"METHOD_NOT_ALLOWED"}}));return;}
      }
      if(!controller.signal.aborted)response.writeHead(200).end(JSON.stringify({data}));
    }catch(cause){
      const code=(cause as {code?:unknown})?.code;
      if(!response.headersSent&&!response.destroyed)response.writeHead(503).end(JSON.stringify({error:{code:typeof code==="string"&&/^KUBERNETES_[A-Z0-9_]+$/.test(code)?code:"KUBERNETES_MANAGER_UNAVAILABLE"}}));
    }finally{clearTimeout(timeout);request.off("aborted",disconnect);response.off("close",disconnect);}
  });
  server.requestTimeout=45000;server.headersTimeout=10000;server.listen(port,"0.0.0.0");return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startKubernetesRuntimeManager();
