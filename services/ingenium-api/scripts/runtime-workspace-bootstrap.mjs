/** Exact workspace-v2 PID bootstrap. Missing actual MCP interface is fatal, never a fake Project. */
import {open,lstat,mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {deriveWorkspaceRuntimeOpenCodePasswordV2} from '/app/packages/ingenium-core/dist/lib/tools/workspace-runtime-auth.mjs';
import {spawn} from 'node:child_process';
import {parseStrictJobJson} from "../lib/dot-v2/job-bootstrap-frame.mjs";
const fail=()=>{throw Error('Workspace runtime bootstrap unavailable');};
const env=name=>{const v=process.env[name];if(typeof v!=='string'||!v||v!==v.trim()||/[\u0000-\u001f]/.test(v))return fail();return v;};
async function frame(){return await new Promise((resolve,reject)=>{let bytes=Buffer.alloc(0);const t=setTimeout(()=>done(Error('bootstrap deadline')),10000);const done=(e,v)=>{bytes.fill(0);clearTimeout(t);process.stdin.off('data',data);process.stdin.off('error',error);process.stdin.pause();e?reject(e):resolve(v);};const error=()=>done(Error('bootstrap input unavailable'));const data=b=>{bytes=Buffer.concat([bytes,b]);if(bytes.length>1024)return done(Error('bootstrap bound'));const n=bytes.indexOf(10);if(n<0)return;if(n!==bytes.length-1)return done(Error('bootstrap frame boundary'));try{const v=parseStrictJobJson(bytes,1024);bytes.fill(0);done(null,v);}catch{bytes.fill(0);done(Error('bootstrap frame invalid'));}};process.stdin.on('data',data);process.stdin.once('error',error);process.stdin.resume();});}
async function requireRuntimeClassPidLimit(){
 const expected=process.env.INGENIUM_KUBERNETES_PIDS_LIMIT;if(expected===undefined)return;
 if(!/^[1-9]\d{1,3}$/.test(expected)||Number(expected)<16||Number(expected)>4096)return fail();
 const fd=await open('/sys/fs/cgroup/pids.max',constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=await fd.stat();if(!st.isFile()||st.uid!==0||(st.mode&0o022))return fail();
  const bytes=Buffer.alloc(33),read=await fd.read(bytes,0,bytes.length,0);
  if(read.bytesRead<2||read.bytesRead>32||bytes.subarray(0,read.bytesRead).toString('ascii')!==expected+'\n')return fail();
 }finally{await fd.close();}
}
async function main(){
 if(process.getuid?.()!==1000||process.getgid?.()!==1000||process.env.INGENIUM_EXECUTION_SCOPE!=='workspace'||['INGENIUM_PROJECT','INGENIUM_PROJECT_ID','INGENIUM_PROJECT_NAME'].some(k=>Object.hasOwn(process.env,k)))return fail();
 await requireRuntimeClassPidLimit();
 const f=await frame();if(!f||Object.keys(f).sort().join('|')!=='capability|nonce|protocol|requestId|schemaVersion|startIdentity'||f.schemaVersion!==2||f.protocol!=='workspace-runtime-v2'||!/^[a-f0-9]{64}$/.test(f.nonce)||!/^[a-f0-9]{64}$/.test(f.startIdentity)||typeof f.requestId!=='string'||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(f.capability))return fail();
 const api=new URL(env('INGENIUM_API_URL'));if(api.protocol!=='http:'||api.pathname!=='/api/v1'||api.username||api.password||api.search||api.hash)return fail();
 const url=new URL(api);url.pathname+='/runtime/workspace-v2/bootstrap';
 const response=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+f.capability,'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:2,nonce:f.nonce,runtimeId:env('INGENIUM_RUNTIME_ID'),workspaceId:env('INGENIUM_WORKSPACE_ID'),bindingHash:env('INGENIUM_STORAGE_MAPPING_HASH'),startIdentity:f.startIdentity,requestId:f.requestId}),signal:AbortSignal.timeout(10000)});
 if(response.status!==200)return fail();const parts=[];let size=0;if(!response.body)return fail();for await(const chunk of response.body){size+=chunk.length;if(size>4096)return fail();parts.push(Buffer.from(chunk));}const raw=Buffer.concat(parts);const result=parseStrictJobJson(raw,4096)?.data;
 if(!result||result.startIdentity!==f.startIdentity||result.requestId!==f.requestId||result.schemaVersion!==2||result.nonce!==f.nonce||result.runtimeId!==env('INGENIUM_RUNTIME_ID')||result.workspaceId!==env('INGENIUM_WORKSPACE_ID')||result.bindingHash!==env('INGENIUM_STORAGE_MAPPING_HASH')||!Number.isSafeInteger(result.bindingEpoch)||typeof result.credentialId!=='string')return fail();
 const target='/run/ingenium-runtime/capability';
 const fd=await open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{await fd.writeFile(f.capability+'\n');await fd.sync();const s=await fd.stat();if(s.uid!==1000||s.gid!==1000||s.nlink!==1||(s.mode&0o777)!==0o600)return fail();}finally{await fd.close();}
 const st=await lstat(target);if(!st.isFile()||st.isSymbolicLink()||st.uid!==1000||st.gid!==1000||st.nlink!==1||(st.mode&0o777)!==0o600)return fail();let passwordValue=deriveWorkspaceRuntimeOpenCodePasswordV2(f.capability,{...result,projectId:null,executionGeneration:result.startIdentity});
 const passwordFile=await open('/run/ingenium-runtime/opencode-server-password',constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{await passwordFile.writeFile(passwordValue+'\n');await passwordFile.sync();const p=await passwordFile.stat();if(p.uid!==1000||p.gid!==1000||p.nlink!==1||(p.mode&0o777)!==0o600)return fail();}finally{await passwordFile.close();passwordValue='';}f.capability='';
 // Actual original launcher export and SDK round trip; a missing packaged interface remains a hard gate.
 const mcp=await import('/app/packages/ingenium-extension/dist/scripts/mcp-server.js');
 if(typeof mcp.bootstrapWorkspaceRuntimeV2!=='function')return fail();
 const protocol=await mcp.bootstrapWorkspaceRuntimeV2({credentialFile:target,apiUrl:api.href,workspaceId:result.workspaceId,runtimeId:result.runtimeId,bindingHash:result.bindingHash,bindingEpoch:result.bindingEpoch,nonce:f.nonce});
 if(protocol?.schemaVersion!==2||protocol?.ready!==true)return fail();
 // Original Core/API admission validates protected deployment; child projects only descriptor-safe files, never opens Core DB.
 await mkdir('/home/appuser/.config/opencode/runtime/agents',{recursive:true,mode:0o700});
 await new Promise((resolve,reject)=>{const helper=spawn(process.execPath,['/app/scripts/project-agent-profiles.mjs','--project-server-owned','/app/.opencode/agents','/home/appuser/.config/opencode/runtime/agents'],{stdio:'ignore',shell:false});helper.once('error',reject);helper.once('exit',code=>code===0?resolve():reject(Error('workspace agent projection unavailable')));});
 const password=await lstat('/run/ingenium-runtime/opencode-server-password');if(!password.isFile()||password.isSymbolicLink()||(password.mode&0o077)!==0||password.uid!==1000)return fail();
 process.env.INGENIUM_RUNTIME_BIND_HOST='0.0.0.0';
 const child=spawn('supervisord',['-c','/app/runtime-supervisord.conf'],{stdio:['inherit','pipe','pipe'],shell:false});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 const ack={schemaVersion:2,protocol:'workspace-runtime-v2',nonce:f.nonce,runtimeId:result.runtimeId,workspaceId:result.workspaceId,credentialId:result.credentialId,bindingHash:result.bindingHash,bindingEpoch:result.bindingEpoch,startIdentity:result.startIdentity,mcpProtocol:2};
 process.stdout.write(JSON.stringify(ack)+'\n',()=>{child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);});
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
 child.once('exit',(code,signal)=>{process.exitCode=Number.isInteger(code)?code:signal?1:0;process.stdin.destroy();});
}
main().catch(()=>{process.stderr.write('Workspace runtime bootstrap unavailable\n');process.exitCode=1;process.stdin.destroy();});
