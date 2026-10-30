import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url));
const checkout=path.resolve(root,"../../../..");
for(const name of fs.readdirSync(root)){
 const file=path.join(root,name);
 if(fs.statSync(file).isFile())fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"").replace(/\r\n/g,"\n"));
}
const readme=path.join(root,"README.md");
let text=fs.readFileSync(readme,"utf8");
text=text.replace("zero diagnostics/emitted files. Covers","zero diagnostics/emitted files. An additional 8 portable React/source modules pass strict/noUnused noEmit using existing Native peers read-only, zero diagnostics/emissions (not the full Native App type check). Both patches passed read-only git apply --check against the unchanged Native working tree. Covers");
fs.writeFileSync(readme,text);
const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8"));
const receipt={
 schemaVersion:1,date:"2026-10-30",owner:"01a18935-0723-7cc0-9ea1-5e70f5627cc5",
 boundary:"Source adapter delivery, not full goal/runtime/visual acceptance",
 tests:{protocol:{passed:30,failed:0,skipped:0,command:"node --test packages/veyra-customize/hosted-governance/governance.node.mjs"},
  syntax:{files:9,diagnostics:0},pureStrictNoEmit:{files:5,diagnostics:0,emitted:0},
  portableReactStrictNoEmit:{files:8,diagnostics:0,emitted:0,peers:"Read-only existing Native apps/web peer resolution"},
  nativeReadOnlyPatchCheck:{passed:true,baselineTree:manifest.baselineTree,patches:manifest.patches,prerequisiteDrift:[]},
  rendererCases:{supplied:11,run:false,owner:"Coordinator central Native runner"},
  rootSourceAuthRegression:{reportedCommit:"252bc93d",reportedPassed:15,workerRun:false}},
 retained:{canonicalSourceFiles:manifest.files.length,canonicalSourceBytes:manifest.files.reduce((n,f)=>n+f.bytes,0),
  consumer:manifest.retainedConsumer,endCondition:manifest.endCondition},
 cleanup:{generatedDisposableOutputs:[],removedPaths:[],removedBytes:0,linuxRecoveryClaimed:false,windowsRecoveryClaimed:false,
  protected:["Native checkout/index","Root shared test caches","source/lockfiles","runtime/credentials/models","prior unique evidence"]},
 remaining:["Root concrete authenticated original transport and actual actor/installation/project mapping",
  "Atomic absent-create and reviewed-write checks in actual legacy owner; no pretend PATCH CAS",
  "Original target/source maintenance locks retained privately",
  "Full Native App types and renderer cases","Real authenticated persistence/workflow and screenshot acceptance",
  "Actual synthesis batch, proposal approval, persisted activation, fresh-conversation use","Windows artifact and Linux cluster acceptance"]
};
fs.writeFileSync(path.join(root,"verification.json"),JSON.stringify(receipt,null,2)+"\n");
const statusFile=path.resolve(checkout,"../../coordination/customize/status.json");
const status=JSON.parse(fs.readFileSync(statusFile,"utf8"));
status.portableGovernance={...status.portableGovernance,sourceStatus:"ready for coordinator integration",
 durableSourceFiles:manifest.files.length,durableSourceBytes:receipt.retained.canonicalSourceBytes,
 patches:manifest.patches,baselineTree:manifest.baselineTree,verification:receipt.tests,remaining:receipt.remaining};
status.progressUpdate="Portable hosted governance source and optional Native slot composition ready; 30 protocol tests + 8 portable React modules strict checks; no full goal completion.";
fs.writeFileSync(statusFile,JSON.stringify(status,null,2)+"\n");
console.log(JSON.stringify({receipt:"docs/workstreams/customize/native-governance/verification.json",statusUpdated:true}));
