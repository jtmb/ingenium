import fs from "node:fs";import path from "node:path";import {spawnSync} from "node:child_process";import {createHash} from "node:crypto";import {fileURLToPath} from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url)),checkout=path.resolve(root,"../../../.."),phase=path.resolve(checkout,"../.."),app=path.resolve(phase,"../prd-ui-fixes"),base="b2832ba29663a12d5d0c2df70fc0859e64ea661c";
const digest=b=>createHash("sha256").update(b).digest("hex"),walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(v=>v.isDirectory()?walk(path.join(d,v.name)):[path.join(d,v.name)]);
const shared=[...JSON.parse(fs.readFileSync(root+"/assembly-preimages.json","utf8")),...["vault-guard","mcp-guard","core-export"].map(n=>JSON.parse(fs.readFileSync(root+"/"+n+"-preimage.json","utf8")))];
const record=[],patches={native:"",node:""};let consolidated="";
function diff(relative,pre,file){
 const result=spawnSync("diff",["-u","--label","a/"+relative,"--label","b/"+relative,"-",file],{input:pre,maxBuffer:2e6});
 if(result.status===0)return "";if(result.status!==1)throw Error("diff "+relative+":"+result.stderr);
 return "diff --git a/"+relative+" b/"+relative+"\n"+(pre.length===0?"new file mode 100644\n":"")+result.stdout.toString("utf8").replace("--- a/"+relative,pre.length===0?"--- /dev/null":"--- a/"+relative);
}
for(const file of walk(root+"/files")){
 const relative=path.relative(root+"/files",file).replaceAll("\\","/");
 if(relative.startsWith("apps/web/"))continue;
 const ref=path.relative(checkout,file).replaceAll("\\","/");
 const old=spawnSync("git",["show",base+":"+ref],{cwd:checkout,maxBuffer:2e6});
 let pre=old.status===0?old.stdout:Buffer.alloc(0),kind=relative.startsWith("services/")||relative.startsWith("packages/ingenium-core/")?"node":"native";
 const receipt=shared.find(v=>v.path===relative);
 if(receipt){pre=fs.readFileSync(app+"/"+relative);if(digest(pre)!==receipt.sha256)throw Error("Shared preimage drift: "+relative);}
 if(kind==="native")pre=Buffer.from(pre.toString("utf8").replaceAll("command:&Read","command:&contracts::Read"));
 let post=fs.readFileSync(file);
 if(!file.endsWith("official-golden-vectors.json")){post=Buffer.from(post.toString("utf8").replaceAll("\r\n","\n"));fs.writeFileSync(file,post);pre=Buffer.from(pre.toString("utf8").replaceAll("\r\n","\n"));}
 if(kind==="node"){const actual=fs.existsSync(app+"/"+relative)?fs.readFileSync(app+"/"+relative):Buffer.alloc(0);consolidated+=diff(relative,actual,file);}
 if(pre.equals(post))continue;
 patches[kind]+=diff(relative,pre,file);
 record.push({target:relative,base:pre.length?digest(pre):null,sha256:digest(post),bytes:post.length,kind});
}
for(const [kind,value]of Object.entries(patches))fs.writeFileSync(root+"/"+kind+"-pairing-followon.patch",value);
fs.writeFileSync(root+"/node-pairing-consolidated.patch",consolidated);
const receipt={baseCommit:base,normalizedPatchContext:"LF; Root r6 contracts::Read fix already present",consolidatedNodePatchSha256:digest(consolidated),files:record,patches:Object.fromEntries(Object.keys(patches).map(kind=>[kind,{path:kind+"-pairing-followon.patch",sha256:digest(fs.readFileSync(root+"/"+kind+"-pairing-followon.patch"))}]))};
fs.writeFileSync(root+"/pairing-followon-manifest.json",JSON.stringify(receipt,null,2)+"\n");console.log(JSON.stringify({files:record.length,patches:receipt.patches,consolidatedNodePatchSha256:receipt.consolidatedNodePatchSha256}));