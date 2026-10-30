// Writes only this worker's owned docs artifacts; never applies the proposal.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {proposeVscodeRemoval,sha256} from './vscode-removal-proposal.mjs';
function unifiedCandidatePatch(before,after,file){
 const lines=b=>{const s=b.toString('utf8'),a=s.split('\n'),nl=s.endsWith('\n');if(nl)a.pop();if(!s)return[];return a.map((text,i)=>({text,eol:i<a.length-1||nl}));},a=lines(before),b=lines(after),same=(x,y)=>x.text===y.text&&x.eol===y.eol;
 const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=same(a[i],b[j])?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
 const ops=[];let i=0,j=0;while(i<a.length||j<b.length){const old=i,next=j;if(i<a.length&&j<b.length&&same(a[i],b[j])){ops.push({kind:' ',...a[i++],old,next});j++;}else if(i<a.length&&(j===b.length||dp[i+1][j]>=dp[i][j+1]))ops.push({kind:'-',...a[i++],old,next});else ops.push({kind:'+',...b[j++],old,next});}
 const groups=[];for(const n of ops.flatMap((v,n)=>v.kind===' '?[]:[n])){const first=Math.max(0,n-3),last=Math.min(ops.length,n+4),g=groups.at(-1);if(g&&first<=g.last)g.last=Math.max(g.last,last);else groups.push({first,last});}
 const rows=[`diff --git a/${file} b/${file}`,before.length?'--- a/'+file:'--- /dev/null','+++ b/'+file];
 for(const{first,last}of groups){const h=ops.slice(first,last),old=h.filter(o=>o.kind!=='+').length,next=h.filter(o=>o.kind!=='-').length;rows.push(`@@ -${h[0].old+(old?1:0)},${old} +${h[0].next+(next?1:0)},${next} @@`);for(const op of h){rows.push(op.kind===' '&&op.text===''?'':op.kind+op.text);if(!op.eol)rows.push('\\ No newline at end of file');}}
 return rows.join('\n')+'\n';
}
const root=process.env.VEYRA_REMOVAL_ROOT;
if(!root)throw Error('Read-only Root source required');
const docs=path.dirname(fileURLToPath(import.meta.url));
const source=proposeVscodeRemoval(root);
function git(args){
 if(process.platform==='win32')return execFileSync('wsl',['-d','Ubuntu','-u','brajam','--','git','-C',process.env.VEYRA_REMOVAL_LINUX_ROOT,...args],{encoding:'utf8'}).trimEnd();
 return execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trimEnd();
}
const rootHead=git(['rev-parse','HEAD']);
const modeRows=git(['ls-files','-s','--',...source.map(f=>f.path)]).split('\n');
const modes=new Map(modeRows.map(l=>[l.split('\t')[1],l.split(' ')[0]]));
const patch=source.map(f=>{
 let delta=unifiedCandidatePatch(f.before,f.after??Buffer.alloc(0),f.path);
 if(f.after===null){
  const mode=modes.get(f.path);if(!/^100(644|755)$/.test(mode))throw Error('Unreviewed mode: '+f.path);
  delta=delta.replace('diff --git a/'+f.path+' b/'+f.path+'\n','diff --git a/'+f.path+' b/'+f.path+'\ndeleted file mode '+mode+'\n').replace('+++ b/'+f.path+'\n','+++ /dev/null\n');
 }
 return delta;
}).join('');
for(const f of source)if(!fs.readFileSync(path.join(root,f.path)).equals(f.before))throw Error('Source changed during freeze: '+f.path);
const receipt={schemaVersion:1,kind:'source-only-vscode-removal-proposal',productBotName:'veyra-bot',rootHead,
 scope:{actualWrites:'docs/workstreams/packaging/ plus existing coordination/packaging/status.json only',proposedCanonicalPaths:source.length,proposedEditorSourceDeletions:4,sharedSourceApplied:false,runtimeExecuted:false,buildExecuted:false,userDataDeleted:false,sourceSnapshotCopied:false},
 ownership:{owner:'packaging worker 01a18935-1a8b-7eb3-a709-d874f70095e8',taskRoot:'/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845',physicalVolume:'existing C-backed WSL Ubuntu ext4 VHDX; original approved root retained',generatedPaths:['docs/workstreams/packaging/vscode-removal-proposal.mjs','docs/workstreams/packaging/vscode-removal.test.mjs','docs/workstreams/packaging/vscode-removal-freeze.mjs','docs/workstreams/packaging/vscode-removal.patch','docs/workstreams/packaging/vscode-removal-receipt.json','docs/workstreams/packaging/vscode-removal.md'],protected:['All shared source and runtime data','Existing workspace/editor homes and vscode-data Docker volumes','Historical backups, DB migrations, restore journal/signature verification','Frozen original-candidate proposal1b3d255131e493d40ca060129fde16e4f5124797','Existing Native targets/Cargo homes/caches/failure evidence'],regeneration:'Set process TEMP/TMP/TMPDIR to existing coordination/packaging; NODE_COMPILE_CACHE empty; VEYRA_REMOVAL_ROOT and Windows-only VEYRA_REMOVAL_LINUX_ROOT name Root source; run Node vscode-removal-freeze.mjs; CPU tests Node --experimental-vm-modules --test ./vscode-removal.test.mjs from owned docs directory'},
 files:source.map(f=>({path:f.path,mode:modes.get(f.path),beforeBytes:f.before.length,beforeSha256:f.beforeSha256,afterBytes:f.after?.length??null,afterSha256:f.afterSha256,action:f.after===null?'proposed-source-delete':'proposed-source-edit'})),patch:{bytes:Buffer.byteLength(patch),sha256:sha256(patch)},
 retainedVendorOverlay:JSON.parse(source.find(f=>f.path==='config/vendor-security.json').after).packages,
 qualification:{windowsNode:'24.18.0',wslNode:'22.23.1',windowsSourceChecks:{passed:12,failed:0},wslSourceChecks:{passed:12,failed:0},shellParseOnly:true,actualStaticValidatorRun:false,packageOrHelmRender:false,installedFilesystemOrProcessCheck:false,liveHTTPOrWebSocketCheck:false,liveWorkWebCLITerminalGitRestore:false},
 remaining:['Root apply/review packaging delta and run original complete validators after integration','Root Core/API/gateway/compatibility/Cloudflare audience removal must deny new and historical vscode tickets/sessions, HTTP and upgrades','Root UI/navigation/iframe/CSP/standalone/Work service targets remove editor launch surfaces','External charts/ingenium in private jtmb/branconet-charts needs source and rendered Service/Ingress/mount/process audit; no chart checkout inspected','Actual build/npm-overlay resolution and all image targets must contain/start no bundled VS Code/code-server','Preserve and verify historical backup/restore; explicit retained legacy data has no live consumer and remains user-protected','Real Work/Web/CLI/terminal/Git/restore + editor denial acceptance; all preexisting candidate and independent approval gates remain open'],
 cleanup:{newDisposableOutputs:[],removedPaths:[],removedBytes:0,retainedReason:'Six minimal source proposal/test/patch/receipt/guide artifacts for Root integration; one existing status updated in place',windowsFreeSpaceRecoveryClaimed:false,linuxFilesystemRecoveryClaimed:false}};
fs.writeFileSync(path.join(docs,'vscode-removal.patch'),patch);
fs.writeFileSync(path.join(docs,'vscode-removal-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({rootHead,paths:source.length,patch:receipt.patch}));
