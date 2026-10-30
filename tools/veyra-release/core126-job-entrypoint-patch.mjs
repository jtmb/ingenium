import {hash,unavailable} from '../../packages/veyra-operations/core126-image-contract.mjs';
export const ENTRYPOINT_PREIMAGE='e0070f091e9500c6e13ef02822c1a56bb50285ab9974d0c6bae543465e7f0e23';
const early=['case "${INGENIUM_RUNTIME_ROLE:-runtime}" in','  job)','    export OPENCODE_CONFIG_PROJECT_DISABLE="1"','    export OPENCODE_CONFIG_DIR="/run/ingenium-runtime/job/config"','    export OPENCODE_CONFIG="/usr/local/share/ingenium/opencode-managed/job-opencode.json"','    unset OPENCODE_CONFIG_CONTENT','    exec node /app/services/ingenium-api/dist/scripts/runtime-job-bootstrap.js','    ;;','  runtime) ;;','  *) echo "ERROR: runtime role unavailable"; exit 1 ;;','esac',''].join('\n');
const late=['  job)','    if [ -z "${INGENIUM_JOB_RUN_ID:-}" ] || [ -z "${INGENIUM_JOB_ATTEMPT_ID:-}" ]; then echo "ERROR: original JobRun identity missing"; exit 1; fi','    exec node /app/services/ingenium-api/dist/scripts/runtime-job-child.js','    ;;',''].join('\n');
function diff(before,after,file='scripts/runtime-entrypoint.sh'){
 const a=before.split('\n'),b=after.split('\n');if(a.at(-1)==='')a.pop();if(b.at(-1)==='')b.pop();
 const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
 const ops=[];let i=0,j=0;while(i<a.length||j<b.length){const old=i,next=j;if(i<a.length&&j<b.length&&a[i]===b[j]){ops.push({kind:' ',text:a[i++],old,next});j++;}else if(i<a.length&&(j===b.length||dp[i+1][j]>=dp[i][j+1]))ops.push({kind:'-',text:a[i++],old,next});else ops.push({kind:'+',text:b[j++],old,next});}
 const edits=ops.flatMap((op,n)=>op.kind===' '?[]:[n]),groups=[];for(const n of edits){let first=Math.max(0,n-3);for(let k=first;k<n;k++)if(ops[k].kind===' '&&ops[k].text==='')first=k+1;const last=Math.min(ops.length,n+4),group=groups.at(-1);if(group&&first<=group.last)group.last=Math.max(group.last,last);else groups.push({first,last});}
 const rows=[`diff --git a/${file} b/${file}`,`--- a/${file}`,`+++ b/${file}`];
 for(const{first,last}of groups){const h=ops.slice(first,last),old=h.filter(op=>op.kind!=='+').length,next=h.filter(op=>op.kind!=='-').length;rows.push(`@@ -${h[0].old+(old?1:0)},${old} +${h[0].next+(next?1:0)},${next} @@`,...h.map(op=>op.kind+op.text));}
 return rows.join('\n')+'\n';
}
/** Exact read-only Root proposal. Never mutates Root or guesses a changed preimage. */
export function proposeCore126JobEntrypoint(raw){
 if(!Buffer.isBuffer(raw)||hash(raw)!==ENTRYPOINT_PREIMAGE)unavailable('exact original runtime entrypoint preimage');
 const before=raw.toString('utf8'),anchor='NODE_ENV=production node --input-type=module -e';if(before.split(anchor).length!==2||before.split(late).length!==2)unavailable('exact job branch anchors');
 const after=before.replace(anchor,early+'\n'+anchor).replace(late,'');
 if(after.indexOf('runtime-job-bootstrap.js')>after.indexOf('normalize-agent-profiles.sh')||after.includes('runtime-job-child.js'))unavailable('early exclusive job bootstrap');
 return{beforeSha256:hash(raw),afterSha256:hash(Buffer.from(after)),after,patch:diff(before,after),classification:'source proposal only; bootstrap wrapper/actual image/SDK qualification REQUIRED'};
}
export const CHILD_PREIMAGE='00d1008145943107a90375fa3dd10040547d47d0a1e8986da9b0946136511942';
export function proposeCore126JobChildConfig(raw){
 if(!Buffer.isBuffer(raw)||hash(raw)!==CHILD_PREIMAGE)unavailable('exact original model-bound child preimage');
 const before=raw.toString('utf8'),old='PWD:"/app",OPENCODE_CONFIG_DIR:"/home/appuser/.config/opencode/runtime",OPENCODE_CONFIG:"/usr/local/share/ingenium/opencode-managed/opencode.json"',next='PWD:"/app",OPENCODE_CONFIG_PROJECT_DISABLE:"1",OPENCODE_CONFIG_DIR:"/run/ingenium-runtime/job/config",OPENCODE_CONFIG:"/usr/local/share/ingenium/opencode-managed/job-opencode.json"';
 if(before.split(old).length!==2)unavailable('exact original child config anchor');
 const after=before.replace(old,next);return{beforeSha256:hash(raw),afterSha256:hash(Buffer.from(after)),after,patch:diff(before,after,'services/ingenium-api/lib/dot-v2/managed-job-child.mjs'),classification:'source proposal only; preserves original model/argv/credential/result owners'};
}