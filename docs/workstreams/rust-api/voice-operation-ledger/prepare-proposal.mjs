import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const base='f86aec9e37df71aae0f3368561669982884c3b15';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function buildVoiceProposal(root) {
 if(!root?.startsWith('/'))throw new Error('Explicit existing integration checkout required');
 const read=path=>execFileSync('git',['-C',root,'show',base+':'+path],{encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
 if(execFileSync('git',['-C',root,'rev-parse',base+'^{commit}'],{encoding:'utf8'}).trim()!==base)throw new Error('Frozen base unavailable');
 const sourceMap={
  'packages/ingenium-core/lib/tools/voice-operation-ledger.ts':'voice-operation-ledger.ts',
  'packages/ingenium-core/lib/tools/voice-operation-cpu.ts':'voice-operation-cpu.ts',
  'packages/ingenium-core/lib/tools/voice-operation-owner.ts':'voice-operation-owner.ts',
  'packages/ingenium-core/lib/tools/voice-operation-contract.ts':'contract-v1.ts',
  'packages/ingenium-core/data/migrations/128_voice_operations.sql':'128_voice_operations.sql',
 };
 const changes=[];
 for(const [path,file] of Object.entries(sourceMap)) {
  let absent=false;try{read(path);}catch{absent=true;}if(!absent)throw new Error('Expected new target absent: '+path);
  const after=readFileSync(new URL(file,import.meta.url),'utf8').replaceAll('"./contract-v1.js"','"./voice-operation-contract.js"');
  changes.push({path,before:'',after,newFile:true});
 }
 const index='packages/ingenium-core/lib/index.ts',before=read(index);
 const exports='\nexport * as voiceOperations from "./tools/voice-operation-ledger.js";\nexport { createVoiceOperationOwner } from "./tools/voice-operation-owner.js";\nexport type { VoiceOperationAuthorities } from "./tools/voice-operation-owner.js";\nexport type { CoreVoiceLedger, CpuRetentionChange, CpuRetentionAck, CpuPrivate, CpuResultFingerprint, VoiceControl } from "./tools/voice-operation-contract.js";\n';
 changes.push({path:index,before,after:before+exports});
 return changes;
}
export function prepareVoiceProposal(root) {
 const changes=buildVoiceProposal(root);
 const py="import json,sys,difflib\nfor c in json.load(sys.stdin):\n sys.stdout.writelines(difflib.unified_diff(c['before'].splitlines(True),c['after'].splitlines(True),fromfile='/dev/null' if c.get('newFile') else 'a/'+c['path'],tofile='b/'+c['path'],n=3))\n";
 const result=spawnSync('python3',['-c',py],{input:JSON.stringify(changes),encoding:'utf8',maxBuffer:4*1024*1024});
 if(result.status!==0)throw new Error('Voice patch rendering failed');
 writeFileSync(new URL('core-voice-owner.patch',import.meta.url),result.stdout);
 const contractPaths=['packages/veyra-voice/session.mjs','services/ingenium-api/lib/voice-v2/cpu-ownership.mjs'];
 const manifest={baseCommit:base,scope:'PROPOSAL ONLY; Root owns SQL128 registration/apply/actual authority bindings',patchSha256:sha(result.stdout),changes:changes.map(c=>({path:c.path,expectedAbsent:!!c.newFile,preimageSha256:c.newFile?null:sha(c.before),proposedSha256:sha(c.after)})),currentContractHashes:contractPaths.map(path=>({path,sha256:sha(readFileSync(root+'/'+path))}))};
 writeFileSync(new URL('preimages.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
}
if(process.argv[1]?.endsWith('/prepare-proposal.mjs'))prepareVoiceProposal(process.argv[2]);
