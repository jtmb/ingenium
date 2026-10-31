import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{removeExactTwoDeclarationRoots}from'./api-two-declaration-roots-proposal.mjs';
export const DECLARATION_EXTENSION_SHA='b887b0e4428e0b200b1c0a5e750c8b5f39f516fda0578190610d36e01fb0623a';
export const CORE_COPIER='packages/ingenium-core/scripts/copy-core-runtime.mjs',API_COPIER='services/ingenium-api/scripts/copy-domain-runtime.mjs';
const pins={ [CORE_COPIER]:['606ac8edf410a3beae4a6d664b540f219c765c8f727af3d2eeb3013bca624cfb','879e2b288460a4bd91c2650e3c31220e9e48d9288837da4065ef5395f479d8cd'],[API_COPIER]:['b360aa94aeea2ad0b743ba1d7bee7b7369ab4867131a881c0f2781d33836c3e5','47cc63df0d161f8f19186547d341bcf60edc093de37750e8e07c3f40dd76af7d']};
const sha=b=>createHash('sha256').update(b).digest('hex');
export function reversePinnedPatch(current,patch,name){
 const lines=current.toString().split('\n'),diff=patch.toString().split('\n'),result=[];let position=0,active=false,hunks=0;
 for(let i=0;i<diff.length;i++){
  if(diff[i].startsWith('diff --git ')){active=diff[i]==='diff --git a/'+name+' b/'+name;continue}
  if(!active)continue;const match=diff[i].match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/);if(!match)continue;
  const oldCount=+match[2],newStart=+match[3]-1,newCount=+match[4];if(newStart<position)throw Error('Overlapping reverse patch');result.push(...lines.slice(position,newStart));position=newStart;let old=0,next=0;hunks++;
  while(old<oldCount||next<newCount){const line=diff[++i];if(line===undefined)throw Error('Truncated pinned patch');const op=line[0]??' ',text=line===''?'':line.slice(1);if(![' ','+','-'].includes(op))throw Error('Invalid pinned patch row');if(op==='+'||op===' '){if(lines[position]!==text)throw Error('Canonical postimage/context differs');position++;next++}if(op==='-'||op===' '){result.push(text);old++}}
 }
 if(!hunks)throw Error('Pinned file has no patch hunks');result.push(...lines.slice(position));return Buffer.from(result.join('\n'));
}
export function decodeCanonicalCurrentBytes(name,raw,patch){const [beforeSha,afterSha]=pins[name]??[];if(!beforeSha)throw Error('Unreviewed copier name');const actualSha=sha(raw),normalized=name===API_COPIER&&actualSha===DECLARATION_EXTENSION_SHA?removeExactTwoDeclarationRoots(raw,{expectedExtendedSha256:DECLARATION_EXTENSION_SHA}):raw;if(sha(normalized)!==afterSha)throw Error('Canonical copier postimage changed; review required: '+name);if(sha(patch)!=='8c4dc5d741ed1b5cd82145a61bac3f60b94e44d1caaab6212e3ed14856c20fee')throw Error('Pinned source patch changed');const before=reversePinnedPatch(normalized,patch,name);if(sha(before)!==beforeSha)throw Error('Reconstructed original preimage mismatch');return{path:name,before,after:raw,preimageSha256:beforeSha,postimageSha256:actualSha,normalizedPostimageSha256:afterSha,baseline:'Only exact reviewed two-root+one-type-package extension normalized IN MEMORY to47cc; original then reverse-patched IN MEMORY'};}
function current(root,name){return decodeCanonicalCurrentBytes(name,fs.readFileSync(path.join(root,name)),fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'core-api-isolated-capsule.patch')));}
export const canonicalCoreProposal=root=>current(root,CORE_COPIER);
export const canonicalApiProposal=root=>current(root,API_COPIER);