import fs from "node:fs";import path from "node:path";import {spawnSync} from "node:child_process";import {createHash} from "node:crypto";import {fileURLToPath} from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url)),checkout=path.resolve(root,"../../../.."),phase=path.resolve(checkout,"../.."),native=phase+"/windows-source",app=path.resolve(phase,"../prd-ui-fixes"),base="74d375b0ab9314557dac768dec0441dc0b9cf3ae";
const hash=b=>createHash("sha256").update(b).digest("hex"),walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(v=>v.isDirectory()?walk(d+"/"+v.name):[d+"/"+v.name]),patches={native:"",node:""},records=[];
function diffFile(p,pre,file){
 const r=spawnSync("diff",["-u","--label","a/"+p,"--label","b/"+p,"-",file],{input:pre,maxBuffer:2e6});
 if(r.status===0)return "";if(r.status!==1)throw Error("diff "+p);
 return "diff --git a/"+p+" b/"+p+"\n"+(pre.length===0?"new file mode 100644\n":"")+r.stdout.toString().replace("--- a/"+p,pre.length?"--- a/"+p:"--- /dev/null");
}
for(const file of walk(root+"/files")){
 const p=path.relative(root+"/files",file).replaceAll("\\","/"),own=path.relative(checkout,file).replaceAll("\\","/"),read=spawnSync("git",["show",base+":"+own],{cwd:checkout,maxBuffer:2e6});
 let pre=read.status===0?read.stdout.toString():"",post=fs.readFileSync(file,"utf8").replaceAll("\r\n","\n");
 if(p==="crates/adapters/src/remote_control/hosted.rs"||p.endsWith("/account_vault/node_hosted.rs"))pre=pre.replace("use super::*;","use super::*;\nuse serde_json::json;");
 if(p.endsWith("/paired-native-reader.ts"))pre=pre.replace('if(!first.startsWith("veyra_remote="))','if(!first||!first.startsWith("veyra_remote="))');
 if(p.endsWith("/routes/mcp-servers.ts"))pre=pre.replace('if (!metadata || metadata.type === "native-pairing-credential")','if (!metadata || !("type" in metadata) || typeof metadata.type !== "string" || metadata.type === "native-pairing-credential")').replace('const status = metadata && metadata.type !== "native-pairing-credential"','const status = metadata && "type" in metadata && typeof metadata.type === "string" && metadata.type !== "native-pairing-credential"');
 if(pre.replaceAll("\r\n","\n")===post)continue;
 fs.writeFileSync(file,post);const kind=p.startsWith("services/")||p.startsWith("packages/")?"node":"native";
 patches[kind]+=diffFile(p,Buffer.from(pre.replaceAll("\r\n","\n")),file);records.push({target:p,preSha256:pre?hash(pre):null,sha256:hash(post),kind});
}
const hooks={native:"",node:""},hookPreimages=[];
function hook(kind,p,transform){
 const pre=fs.readFileSync((kind==="native"?native:app)+"/"+p,"utf8").replaceAll("\r\n","\n"),post=transform(pre);if(pre===post)throw Error("Missing hook "+p);
 const py="import sys,json,difflib\na,b,p=json.load(sys.stdin)\nsys.stdout.write('diff --git a/'+p+' b/'+p+'\\n')\nsys.stdout.writelines(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/'+p,tofile='b/'+p))";
 const delta=spawnSync("python3",["-c",py],{input:JSON.stringify([pre,post,p]),encoding:"utf8",env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"},maxBuffer:2e6});if(delta.status!==0)throw Error(delta.stderr);hooks[kind]+=delta.stdout;hookPreimages.push({target:p,kind,preSha256:hash(pre),postSha256:hash(post)});
}
function once(s,a,b){if(s.split(a).length!==2)throw Error("Ambiguous hook: "+a.slice(0,90));return s.replace(a,b);}
try{
 hook("native","apps/service/src/routes/remote_control.rs",s=>s+'\n'+[
 'pub(super) fn hosted_project_custody(state:&ServiceState,id:Option<&str>)->Result<bool,storage::Error>{',
 ' let journal=veyra_adapters::utility_operations::Store::open(&state.state_directory).map_err(|_|storage::Error::Unavailable)?;',
 ' Ok(state.remote_control.store.hosted_project_is_live(id)?||journal.hosted_project_has_custody(id).map_err(|_|storage::Error::Unavailable)?)',
 '}',
 'pub(super) fn hosted_resource_custody(state:&ServiceState,id:&str)->Result<bool,storage::Error>{',
 ' let journal=veyra_adapters::utility_operations::Store::open(&state.state_directory).map_err(|_|storage::Error::Unavailable)?;',
 ' Ok(state.remote_control.store.hosted_resource_is_live(id)?||journal.hosted_resource_has_custody(id).map_err(|_|storage::Error::Unavailable)?)',
 '}'].join("\n")+"\n");
 hook("native","crates/adapters/src/remote_control.rs",s=>{
 s=once(s,'                db.connections.remove(id).ok_or(Error::NotFound)?;','                if db.connections.get(id).and_then(|c|c.node_hosted.as_ref()).is_some_and(|e|e.retirement.is_none()){return Err(Error::Conflict);}\n                db.connections.remove(id).ok_or(Error::NotFound)?;');
 return once(s,'                // Attempts remain tombstoned.','                if current.node_hosted.as_ref().is_some_and(|e|e.retirement.is_none()){return Err(Error::Conflict);}\n                // Attempts remain tombstoned.');
 });
 hook("native","apps/service/src/routes/catalog.rs",s=>{const a=s.indexOf("pub(super) async fn update(");if(a<0)throw Error("Catalog owner absent");let part=s.slice(a);
 part=once(part,'                let _serial = serial;','                let _serial = serial;\n                if super::remote_control::hosted_project_custody(&state,Some(&id)).map_err(|_|store_error(StoreError::Corrupt))?{return Err(catalog_failure(StatusCode::CONFLICT,ErrorCode::UnknownState,"Hosted custody requires explicit reconciliation before project changes"));}');
 return s.slice(0,a)+part;
 });
 hook("native","apps/service/src/routes/access_profiles.rs",s=>{
 s=once(s,'                let store = &state.remote_control.store;','                if veyra_adapters::utility_operations::Store::open(&state.state_directory).and_then(|j|j.hosted_resource_has_custody(&grant.id)).map_err(|_|Error::Unavailable)?{return Err(Error::Conflict);}\n                let store = &state.remote_control.store;');
 return once(s,'            let (profile, revoked_grant) = metadata(state.clone(), move |state| {\n                let current','            let (profile, revoked_grant) = metadata(state.clone(), move |state| {\n                if delete&&super::remote_control::hosted_resource_custody(state,&expected.id).map_err(|_|Error::Unavailable)?{return Err(Error::Conflict);}\n                let current');
 });
 hook("node","packages/ingenium-core/lib/index.ts",s=>s+'\nexport {assertNativeGovernanceLifecycleClear} from "./tools/node-native-lifecycle.js";\n');
 hook("node","packages/ingenium-core/lib/tools/projects.ts",s=>{
 s='import {assertNativeGovernanceLifecycleClear,assertNativeGovernanceRecoveryRestore} from "./node-native-lifecycle.js";\n'+s;
 const changes=[
 ["archiveProject",'    if (!existing || existing.is_global) return false;','existing.id'],
 ["unarchiveProject",'    if (!existing) return false;','(existing as Project).id'],
 ["unarchiveProjectById",'    if (!existing) return false;','existing.id'],
 ["deleteProject",'    if (!project) return { status: "not_found" } as ProjectDeletionResult;','project.id'],
 ["updateProject",'    if (!existing) return undefined;','existing.id'],
 ["setProjectGlobal",'    if (!existing || existing.archived_at) return false;',null]];
 for(const [fn,needle,id]of changes){const a=s.indexOf("export function "+fn+"("),b=s.indexOf("\nexport function ",a+1),end=b<0?s.length:b;let part=s.slice(a,end);part=once(part,needle,needle+'\n    '+(fn.startsWith('unarchiveProject')?'assertNativeGovernanceRecoveryRestore':'assertNativeGovernanceLifecycleClear')+'(db'+(id?','+id:'')+');');s=s.slice(0,a)+part+s.slice(end);}
 return s;
 });
 hook("node","services/ingenium-api/scripts/restore-maintenance.ts",s=>{
 s='import {assertNativeGovernanceLifecycleClear} from "ingenium-core";\n'+s;
 s=once(s,'    let capsule = backups.captureRestoreExecutionCapsule(global.id, run.id);','    assertNativeGovernanceLifecycleClear(getDb());\n    let capsule = backups.captureRestoreExecutionCapsule(global.id, run.id);');
 return once(s,'    if (hasUnretiredManagedExecutionForRestore(getDb())) throw new MaintenanceError("HOLDER_REFUSED");','    if (hasUnretiredManagedExecutionForRestore(getDb())) throw new MaintenanceError("HOLDER_REFUSED");\n    assertNativeGovernanceLifecycleClear(getDb());');
 });
 for(const kind of ["native","node"]){fs.writeFileSync(root+"/"+kind+"-lifecycle-source.patch",patches[kind]);fs.writeFileSync(root+"/"+kind+"-lifecycle-hooks.patch",hooks[kind]);}
 fs.writeFileSync(root+"/lifecycle-manifest.json",JSON.stringify({base,preimagesNormalizedLF:true,files:records,hookPreimages,patches:Object.fromEntries(["native","node"].flatMap(kind=>["source","hooks"].map(part=>{const p=kind+"-lifecycle-"+part+".patch";return[p,{sha256:hash(fs.readFileSync(root+"/"+p)),bytes:fs.statSync(root+"/"+p).size}];})))},null,2)+"\n");
}finally{/* All shared postimages/diffs remain in memory; no scratch, build or cache files. */}
console.log(JSON.stringify({sourceFiles:records.length,hooks:hookPreimages.length}));