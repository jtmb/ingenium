import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
import{parseContract}from'./candidate-closure-proposal.mjs';
export const CORE_HELPERS=Object.freeze(['lib/tools/learned-memory-restore.mjs','lib/tools/learned-memory-restore.d.mts','lib/tools/voice-attachment-restore.mjs','lib/tools/voice-attachment-restore.d.mts']);
export const CORE_COPIER='packages/ingenium-core/scripts/copy-core-runtime.mjs';
export function proposeCoreRuntime(root){
 const docs=path.dirname(fileURLToPath(import.meta.url)),source=fs.readFileSync(path.join(docs,'core-runtime-copier-source.mjs')),edits=[];
 const once=(s,a,b)=>{if(!s.includes(a)||s.indexOf(a)!==s.lastIndexOf(a))throw Error('Missing/nonunique Core build anchor: '+a.slice(0,100));return s.replace(a,b);};
 const add=(name,transform)=>{const before=fs.readFileSync(path.join(root,name)),raw=before.toString(),crlf=raw.includes('\r\n'),text=transform(raw.replaceAll('\r\n','\n')),after=Buffer.from(crlf?text.replaceAll('\n','\r\n'):text);if(after.equals(before))throw Error('Unchanged Core proposal');edits.push({path:name,before,after});};
 if(fs.existsSync(path.join(root,CORE_COPIER)))throw Error('Original Core copier already exists; review actual owner before proposing replacement');
 for(const name of CORE_HELPERS)if(!fs.lstatSync(path.join(root,'packages/ingenium-core',name)).isFile())throw Error('Missing actual canonical helper: '+name);
 edits.push({path:CORE_COPIER,before:Buffer.alloc(0),after:source});
 add('packages/ingenium-core/package.json',s=>once(s,'"build": "rm -rf dist && tsc && cp -r data dist/data"','"build": "rm -rf dist && tsc && node scripts/copy-core-runtime.mjs && cp -r data dist/data"'));
 const original=parseContract(fs.readFileSync(path.join(root,'packages/veyra-operations/core126-image-contract.mjs'),'utf8'));
 const sourceAdditions=[CORE_COPIER,'packages/ingenium-core/lib/tools/backups.ts',...CORE_HELPERS.map(name=>'packages/ingenium-core/'+name),'packages/ingenium-core/data/migrations/132_voice_attachment_deliveries.sql'].filter(p=>!original.source.includes(p));
 const imageAdditions=['/app/packages/ingenium-core/dist/lib/tools/backups.js',...CORE_HELPERS.map(name=>'/app/packages/ingenium-core/dist/'+name),'/app/packages/ingenium-core/dist/veyra-core-runtime-closure.json','/app/packages/ingenium-core/dist/data/migrations/132_voice_attachment_deliveries.sql'].filter(p=>!original.image.includes(p));
 add('packages/veyra-operations/core126-image-contract.mjs',s=>{
  s=once(s,original.sourceAnchor,'export const SOURCE_INPUTS=Object.freeze('+JSON.stringify([...original.source,...sourceAdditions])+');');
  return once(s,original.imageAnchor,'export const IMAGE_INPUTS=Object.freeze('+JSON.stringify([...original.image,...imageAdditions])+');');
 });
 add('Dockerfile',s=>{
  const code="const fs=require('node:fs');for(const file of "+JSON.stringify(imageAdditions)+"){const st=fs.lstatSync(file);if(fs.realpathSync(file)!==file||!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o022)||st.size<1)throw Error('Original Core restore artifact unavailable: '+file);}";
  const quoted="'"+code.replaceAll("'","'\\''")+"'";
  return once(s,'# COPY already assigns root ownership.','# Verify the same Core build-owned explicit restore helper closure and actual SQL132 consumer path.\nRUN node -e '+quoted+'\n# COPY already assigns root ownership.');
 });
 return{edits,original,sourceAdditions,imageAdditions};
}
