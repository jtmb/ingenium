import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
const root=path.dirname(fileURLToPath(import.meta.url));
const checkout=path.resolve(root,"../../../..");
const sourceRoot=path.join(checkout,"packages/veyra-customize/hosted-governance");
const args=process.argv.slice(2);
function flag(name){const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error("Missing "+name);return args[i+1];}
const native=flag("--native"),gitRoot=flag("--git-root"),git=flag("--git-executable");
const tree="a04ab38bd0e0c7b96f40689733cad3f2332b9a0b";
const canonical=data=>Buffer.from(data.toString("utf8").replace(/^\uFEFF/,"").replace(/\r\n/g,"\n"),"utf8");
const hash=data=>createHash("sha256").update(data).digest("hex");
const gitRead=(...more)=>execFileSync(git,["-c","safe.directory="+gitRoot,"-c","core.longpaths=true","-C",gitRoot,...more],{stdio:["ignore","pipe","pipe"]});
if(gitRead("cat-file","-t",tree).toString().trim()!=="tree")throw new Error("Native baseline tree is unavailable");
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  if(entry.isSymbolicLink())throw new Error("Symlinks are not deliverable");
  const file=path.join(dir,entry.name);return entry.isDirectory()?walk(file):[file];
});}
const files=walk(sourceRoot).sort().map(file=>{
  const relative=path.relative(sourceRoot,file).split(path.sep).join("/");
  const target="apps/web/src/features/customize/hosted-governance/"+relative;
  if(fs.existsSync(path.join(native,target)))throw new Error("Preserve existing native target: "+target);
  const data=canonical(fs.readFileSync(file));
  if(!data.toString().endsWith("\n"))throw new Error("Missing final LF: "+relative);
  fs.writeFileSync(file,data);
  return {source:path.relative(checkout,file).split(path.sep).join("/"),target,precondition:"absent",preSha256:null,postSha256:hash(data),bytes:data.length};
});
const helper=JSON.parse(fs.readFileSync(path.join(sourceRoot,"helper-provenance.json"),"utf8"));
if(files.find(f=>f.target.endsWith("/skill-write-outcomes.mjs")).postSha256!==helper.sha256)throw new Error("C4 runtime changed");
const target="apps/web/src/features/customize/NativeCustomize.tsx";
const before=canonical(gitRead("cat-file","blob",tree+":"+target)).toString();
let after=before;
function replaceOnce(search,replacement){
  if(after.split(search).length!==2)throw new Error("Composition marker is not unique");
  after=after.replace(search,replacement);
}
replaceOnce('import "./native-customize.css";',
'import type { Binding as HostedBinding, BoundGovernanceTransport, Skill as HostedSkill } from "./hosted-governance/contracts";\nimport { hostedGovernanceSlotFromOriginal } from "./hosted-governance/HostedGovernanceSlot";\nimport "./native-customize.css";');
replaceOnce('  hostedGovernance?: HostedGovernanceBinding & Readonly<{content: ReactNode}>;',
'  hostedGovernance?: HostedGovernanceBinding & Readonly<{content: ReactNode}>;\n  /** Already authenticated and retained by Root; this component cannot enroll a transport. */\n  hostedGovernanceTransport?: BoundGovernanceTransport;\n  onOpenHostedSkillInSession?: (skill: HostedSkill, binding: HostedBinding) => void;');
replaceOnce('  const project = props.project;',
'  const project = props.project;\n  const hostedGovernance = props.hostedGovernance ?? (props.hostedGovernanceTransport\n    ? hostedGovernanceSlotFromOriginal(props.hostedGovernanceTransport, props.onOpenHostedSkillInSession) : undefined);');
replaceOnce('  return <CustomizeOwner key={owner} {...props} kind={kind} setKind={setKind}/>;',
'  return <CustomizeOwner key={owner} {...props} hostedGovernance={hostedGovernance} kind={kind} setKind={setKind}/>;');
// Three-line context hunks keep the optional composition change small and exact.
// No temporary checkout, output copies or native mutation are needed.
const a=before.slice(0,-1).split("\n"),b=after.slice(0,-1).split("\n");
const lcs=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)lcs[i][j]=a[i]===b[j]?1+lcs[i+1][j+1]:Math.max(lcs[i+1][j],lcs[i][j+1]);
const edits=[];let i=0,j=0;
while(i<a.length||j<b.length){
  if(i<a.length&&j<b.length&&a[i]===b[j]){edits.push(" "+a[i++]);j++;}
  else if(j<b.length&&(i===a.length||lcs[i][j+1]>=lcs[i+1][j]))edits.push("+"+b[j++]);
  else edits.push("-"+a[i++]);
}
let oldLine=1,newLine=1;
const positions=edits.map(line=>{const result={oldLine,newLine};if(!line.startsWith("+"))oldLine++;if(!line.startsWith("-"))newLine++;return result;});
const ranges=[];
for(let k=0;k<edits.length;k++)if(!edits[k].startsWith(" ")){
  const start=Math.max(0,k-3),end=Math.min(edits.length,k+4),last=ranges.at(-1);
  if(last&&start<=last.end)last.end=Math.max(last.end,end);else ranges.push({start,end});
}
const composition="diff --git a/"+target+" b/"+target+"\n--- a/"+target+"\n+++ b/"+target+"\n"+ranges.map(({start,end})=>{
  const lines=edits.slice(start,end),oldCount=lines.filter(x=>!x.startsWith("+")).length,newCount=lines.filter(x=>!x.startsWith("-")).length;
  return "@@ -"+positions[start].oldLine+","+oldCount+" +"+positions[start].newLine+","+newCount+" @@\n"+lines.map(line=>line===" "?"":line).join("\n")+"\n";
}).join("");
const portable=files.map(file=>{
  const lines=fs.readFileSync(path.join(checkout,file.source),"utf8").slice(0,-1).split("\n");
  return "diff --git a/"+file.target+" b/"+file.target+"\nnew file mode 100644\n--- /dev/null\n+++ b/"+file.target+"\n@@ -0,0 +1,"+lines.length+" @@\n"+lines.map(line=>"+"+line).join("\n")+"\n";
}).join("");
fs.writeFileSync(path.join(root,"portable-source.patch"),portable);
fs.writeFileSync(path.join(root,"native-composition.patch"),composition);
const prerequisitePaths=[
  target,"apps/web/src/features/customize/nativeCatalog.ts","apps/web/src/platform/gateway.ts",
  "apps/web/src/features/remote-hosts/RemoteConnectionWorkspace.tsx",
  "apps/web/src/features/remote-hosts/remoteWorkspaceRead.ts",
  "apps/web/src/features/remote-hosts/remoteWorkspaceDiscovery.ts",
  "apps/service/src/routes/remote_control/proxy.rs"
];
const prerequisites=prerequisitePaths.map(file=>{
  const data=gitRead("cat-file","blob",tree+":"+file),live=fs.readFileSync(path.join(native,file));
  return {path:file,baselineBlob:gitRead("rev-parse",tree+":"+file).toString().trim(),
    baselineCanonicalSha256:hash(canonical(data)),observedCanonicalSha256:hash(canonical(live)),
    currentCanonicalMatchesBaseline:hash(canonical(data))===hash(canonical(live))};
});
const manifest={schemaVersion:1,baselineTree:tree,
  canonicalization:"UTF-8 without BOM; CRLF to LF; otherwise bytes preserved",
  mode:"Canonical portable sources plus exact optional composition patch; no native mutation",
  files,composition:{path:target,baselineBlob:gitRead("rev-parse",tree+":"+target).toString().trim(),
    preSha256:hash(Buffer.from(before)),postSha256:hash(Buffer.from(after)),addedLines:edits.filter(x=>x.startsWith("+")).length,
    removedLines:edits.filter(x=>x.startsWith("-")).length},
  patches:{"portable-source.patch":hash(Buffer.from(portable)),"native-composition.patch":hash(Buffer.from(composition))},
  prerequisites,helper,
  generatedDisposableOutputs:[],removedPaths:[],removedBytes:0,
  retainedConsumer:"Root reviewed integration, original bridge implementation, central type/UI tests and actual Native workflow acceptance",
  endCondition:"Keep minimal canonical source, patches, manifest and unique verification receipts; Root reconciles its own central outputs"};
fs.writeFileSync(path.join(root,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify({files:files.length,sourceBytes:files.reduce((n,f)=>n+f.bytes,0),patches:manifest.patches,
  composition:manifest.composition,prerequisiteDrift:prerequisites.filter(p=>!p.currentCanonicalMatchesBaseline).map(p=>p.path)}));
