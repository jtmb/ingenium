import fs from "node:fs";import path from "node:path";import {createHash} from "node:crypto";import {fileURLToPath} from "node:url";
import {source,names,transformed} from "./portable-compat.mjs";
const root=path.dirname(fileURLToPath(import.meta.url)),checkout=path.resolve(root,"../../../.."),phase=path.resolve(checkout,"../..");
const native=path.join(phase,"windows-source"),app=path.resolve(phase,"../prd-ui-fixes"),filesRoot=path.join(root,"files");
const canonical=b=>Buffer.from(b.toString("utf8").replace(/^\uFEFF/,"").replace(/\r\n/g,"\n"));
const hash=b=>createHash("sha256").update(b).digest("hex");
const before=new Map(),after=new Map();
function edit(target,change){const data=canonical(fs.readFileSync(path.join(native,target))).toString();before.set(target,data);let next=data;const once=(a,b)=>{if(next.split(a).length!==2)throw new Error("Native preimage marker "+target+": "+a.slice(0,60));next=next.replace(a,b);};change(once,()=>next,v=>next=v);after.set(target,next);}
edit("crates/adapters/src/utility_operations.rs",once=>once('use rusqlite::','mod hosted;\nuse rusqlite::'));
edit("crates/adapters/src/remote_control.rs",(once,get,set)=>{
 once('pub mod client;','pub mod client;\npub mod hosted;');
 once('struct Grant {\n','struct Grant {\n    #[serde(default)]\n    node_custodian: Option<hosted::attestation::Custodian>,\n');
 once('struct Pairing {\n','struct Pairing {\n    #[serde(default)]\n    node_custodian: Option<hosted::attestation::Custodian>,\n');
 once('struct StoredConnection {\n','struct StoredConnection {\n    #[serde(default)]\n    node_hosted: Option<hosted::Enrollment>,\n');
 once('                    Pairing {\n','                    Pairing {\n                        node_custodian: None,\n');
 once('                    Grant {\n','                    Grant {\n                        node_custodian: pairing.node_custodian,\n');
 once('            grant_id: connection.grant_id,\n','            grant_id: connection.grant_id,\n            node_hosted: None,\n');
 once('        let token = open_token(\n','        if saved.node_hosted.is_some() { return Err(Error::Forbidden); }\n        let token = open_token(\n');
 const all=get(),connectionsStart=all.indexOf("    pub fn connections(&self)"),connectionsEnd=all.indexOf("    /// Check retained public owners",connectionsStart);
 if(connectionsStart<0||connectionsEnd<0)throw new Error("Connections owner marker missing");
 const connections=all.slice(connectionsStart,connectionsEnd);once(connections,connections.replace("                    .values()","                    .values()\n                    .filter(|entry| entry.node_hosted.is_none())"));
 once('        "projects_read",','        "hosted_enrollment",\n        "hosted_governance_read",\n        "hosted_governance_write",\n        "projects_read",');
 once('        || scope.project_ids.is_empty()','        || scope.project_ids.is_empty() && scope.permissions != ["hosted_enrollment"]');
});
edit("crates/adapters/src/remote_control/client.rs",(once,get,set)=>{
 const s=get(),start=s.indexOf("fn client(connection: &Connection)"),end=s.indexOf("fn url(",start);
 if(start<0||end<0)throw new Error("Pinned client preimage unavailable");
 const original=s.slice(start,end);
 const extracted=original.replace("fn client(connection: &Connection)","pub(super) fn pinned_client(certificate_pem: &str, certificate_sha256: &str)")
  .replaceAll("connection.certificate_pem","certificate_pem").replaceAll("connection.view.certificate_sha256.clone()","certificate_sha256.to_string()").replaceAll("connection.view.certificate_sha256","certificate_sha256");
 once(original,'fn client(connection: &Connection) -> Result<reqwest::blocking::Client, Error> {\n    pinned_client(&connection.certificate_pem, &connection.view.certificate_sha256)\n}\n'+extracted);
});
edit("crates/adapters/src/access_profiles.rs",once=>once('"projects_read" | "tasks_read" | "files_read" | "reviews_read" | "pages_read"','"projects_read" | "tasks_read" | "files_read" | "reviews_read" | "pages_read" | "hosted_enrollment" | "hosted_governance_read"'));
edit("crates/adapters/src/account_vault.rs",(once,get,set)=>{
 once('pub mod oauth;','pub mod oauth;\npub mod node_hosted;');
 const s=get(),start=s.indexOf('        if !input.credential_file.is_absolute()'),end=s.indexOf('        self.provision(Provision {',start);
 if(start<0||end<0)throw new Error("Credential-file owner preimage missing");
 const body=s.slice(start,end);
 once(body,'        let credentials = read_credential_file(&input.credential_file)?;\n');
 set(get()+'\n// Shared original credential-file reader; private Node MFA reuses these exact handle/reparse/zeroing checks.\nfn read_credential_file(path: &Path) -> Result<BTreeMap<String,String>,Error> {\n'+body.replaceAll('input.credential_file','path')+'        Ok(credentials)\n}\n');
 once('        oauth::validate_account_credential(&vault, &binding.account_id)?;','        if record.account.provider == "ingenium-node-hosted" { return Err(Error::Invalid); }\n        oauth::validate_account_credential(&vault, &binding.account_id)?;');
 once('        if record.account.environment != project.environment {','        if record.account.provider == "ingenium-node-hosted" { return Err(Error::Invalid); }\n        if record.account.environment != project.environment {');
 once('            oauth::validate_account_credential(self, &binding.account_id)?;','            if record.account.provider == "ingenium-node-hosted" { return Err(Error::Invalid); }\n            oauth::validate_account_credential(self, &binding.account_id)?;');
});
edit("apps/service/src/routes/remote_control.rs",once=>{
 once('mod proxy;','mod proxy;\nmod hosted_governance;');
 once('        .nest("/collaboration", collaboration::router())','        .nest("/connections/{id}/hosted-governance", hosted_governance::router())\n        .nest("/node-hosted", hosted_governance::account_router())\n        .nest("/collaboration", collaboration::router())');
});
edit("apps/service/src/routes/remote_control/proxy.rs",once=>once('        .route("/remote/v1/pair", post(pair))','        .merge(super::hosted_governance::paired_router())\n        .route("/remote/v1/pair", post(pair))'));
edit("apps/web/src/platform/gateway.ts",once=>once('  workbench: async (method, path, body, currentView) => {',
 '  workbench: async (method, path, body, currentView) => {\n    if (/^\\/v1\\/remote-control\\/connections\\/[^/?]+\\/hosted-governance\\//.test(path)\n      && !(method === "POST" && /^\\/v1\\/remote-control\\/connections\\/[a-f\\d-]+\\/hosted-governance\\/(context|read|reserve|send|inspect|pending)$/.test(path) && record(body)))\n      throw new ServiceError("Unsupported typed hosted governance operation");'));
function diff(target,oldText,newText){
 const a=oldText.replace(/\n$/,"").split("\n"),b=newText.replace(/\n$/,"").split("\n");
 const lcs=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)lcs[i][j]=a[i]===b[j]?1+lcs[i+1][j+1]:Math.max(lcs[i+1][j],lcs[i][j+1]);
 const edits=[];let i=0,j=0;
 while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){edits.push(" "+a[i++]);j++;}else if(j<b.length&&(i===a.length||lcs[i][j+1]>=lcs[i+1][j]))edits.push("+"+b[j++]);else edits.push("-"+a[i++]);}
 let oldLine=1,newLine=1;const pos=edits.map(line=>{const p={oldLine,newLine};if(!line.startsWith("+"))oldLine++;if(!line.startsWith("-"))newLine++;return p;});
 const ranges=[];for(let k=0;k<edits.length;k++)if(!edits[k].startsWith(" ")){const start=Math.max(0,k-3),end=Math.min(edits.length,k+4),last=ranges.at(-1);if(last&&start<=last.end)last.end=Math.max(last.end,end);else ranges.push({start,end});}
 return "diff --git a/"+target+" b/"+target+"\n--- a/"+target+"\n+++ b/"+target+"\n"+ranges.map(({start,end})=>{const lines=edits.slice(start,end);return "@@ -"+pos[start].oldLine+","+lines.filter(x=>!x.startsWith("+")).length+" +"+pos[start].newLine+","+lines.filter(x=>!x.startsWith("-")).length+" @@\n"+lines.map(line=>line===" "?"":line).join("\n")+"\n";}).join("");
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{if(e.isSymbolicLink())throw new Error("Owned source link refused");const file=path.join(dir,e.name);return e.isDirectory()?walk(file):[file];});}
const files=walk(filesRoot).sort().map(file=>{
 const target=path.relative(filesRoot,file).split(path.sep).join("/"),realm=target.startsWith("services/")?"APP":"Native",destination=realm==="APP"?app:native;
 if(fs.existsSync(path.join(destination,target)))throw new Error("Preserve existing integration target "+realm+":"+target);
 const data=canonical(fs.readFileSync(file));if(!data.toString().endsWith("\n"))throw new Error("Missing final LF "+target);fs.writeFileSync(file,data);
 return {source:path.relative(checkout,file).split(path.sep).join("/"),realm,target,precondition:"absent",postSha256:hash(data),bytes:data.length};
});
const addPatch=realm=>files.filter(f=>f.realm===realm).map(f=>{const lines=fs.readFileSync(path.join(checkout,f.source),"utf8").slice(0,-1).split("\n");return "diff --git a/"+f.target+" b/"+f.target+"\nnew file mode 100644\n--- /dev/null\n+++ b/"+f.target+"\n@@ -0,0 +1,"+lines.length+" @@\n"+lines.map(line=>"+"+line).join("\n")+"\n";}).join("");
const patches={"native-owner-proposal.patch":addPatch("Native")+[...after.keys()].map(p=>diff(p,before.get(p),after.get(p))).join(""),"node-proof-proposal.patch":addPatch("APP"),
 "portable-compat.patch":names.map(name=>diff("apps/web/src/features/customize/hosted-governance/"+name,fs.readFileSync(path.join(source,name),"utf8"),transformed(name))).join("")};
for(const [name,text]of Object.entries(patches))fs.writeFileSync(path.join(root,name),text);
const frozenContract=path.join(phase,"parallel/rust-api/docs/workstreams/rust-api/hosted-governance/contract-v1.md");
const manifest={schemaVersion:1,mode:"SOURCE PROPOSALS ONLY; no integration writes, builds or credentials",owner:"01a18935-0723-7cc0-9ea1-5e70f5627cc5",
 files,changes:[...after.keys()].map(target=>({realm:"Native",target,preSha256:hash(Buffer.from(before.get(target))),postSha256:hash(Buffer.from(after.get(target)))})),
 compatibility:names.map(name=>({target:"apps/web/src/features/customize/hosted-governance/"+name,preSha256:hash(fs.readFileSync(path.join(source,name))),postSha256:hash(Buffer.from(transformed(name)))})),
 frozenNodeContract:{source:"parallel/rust-api/docs/workstreams/rust-api/hosted-governance/contract-v1.md",sha256:hash(canonical(fs.readFileSync(frozenContract)))},
 patches:Object.fromEntries(Object.entries(patches).map(([name,text])=>[name,hash(Buffer.from(text))])),
 generatedDisposableOutputs:[],removedPaths:[],removedBytes:0,
 prerequisites:["Root implements actual Node private paired Native credential custody/explicit actor-bound pairing ceremony; no body-derived verifier",
 "Root installs synchronous verifier with actual bounded paired preflight and current original/custody checks",
 "Root wires utility custody checks into actual Project/library/full-restore/grant/profile mutation owners",
 "Root shared Node/Core SQL125 and IPC/auth policy integration/security review","Native Rust compile/semantic/lifecycle tests; exact composed Native UI cases"],
 retainedConsumer:"Root source/security review, integration and focused acceptance; keep minimal canonical proposals, patches, source tests and unique receipts"};
fs.writeFileSync(path.join(root,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify({newSources:files.length,newSourceBytes:files.reduce((n,f)=>n+f.bytes,0),existingChanges:manifest.changes.length,patches:manifest.patches}));
