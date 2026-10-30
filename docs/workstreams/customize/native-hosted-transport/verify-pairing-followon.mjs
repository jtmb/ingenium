import fs from "node:fs";import path from "node:path";import {spawnSync} from "node:child_process";import {fileURLToPath} from "node:url";import {createHash} from "node:crypto";
const root=path.dirname(fileURLToPath(import.meta.url)),checks=[];
const env={...process.env,NODE_DISABLE_COMPILE_CACHE:"1"};delete env.NODE_COMPILE_CACHE;
for(const [name,args]of [["protocol-custody-preflight",["--test",...["transport.node.mjs","compatibility.node.mjs","custody.node.mjs","preflight.node.mjs"].map(n=>root+"/"+n)]],["private-node-source",[root+"/check-api-source.mjs"]],["portable-web-source",[root+"/check-source.mjs"]]]){
 const r=spawnSync(process.execPath,args,{encoding:"utf8",env,maxBuffer:2e6});const combined=r.stdout+r.stderr;
 const check={name,exitCode:r.status,stdoutSha256:createHash("sha256").update(r.stdout).digest("hex"),summary:r.stdout.split("\n").filter(s=>/^# (tests|pass|fail|skipped|cancelled) |^\{/.test(s))};
 checks.push(check);console.log(JSON.stringify(check));if(r.status!==0){process.stderr.write(combined);process.exitCode=1;}
}
fs.writeFileSync(root+"/pairing-verification.json",JSON.stringify({checks,actualRuntimeAcceptance:false,nativeRustCompilation:"UNRUN; Root owns",cleanup:{removed:[],bytesRemoved:0,scratchRemaining:[],generatedBuildCacheDependencies:false}},null,2)+"\n");