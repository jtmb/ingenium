// Append only actual reviewed runtime sources/artifacts; no approval or build output.
import fs from'node:fs';import path from'node:path';import{parseContract}from'./candidate-closure-proposal.mjs';
export function proposeCore133Qualification(root,audit){
 const file='packages/veyra-operations/core126-image-contract.mjs',before=fs.readFileSync(path.join(root,file)),raw=before.toString(),crlf=raw.includes('\r\n');let text=raw.replaceAll('\r\n','\n');const current=parseContract(text);
 const sourceAdditions=audit.critical.map(r=>r.source).filter(name=>!current.source.includes(name)),imageAdditions=audit.critical.map(r=>r.artifact).filter(name=>!current.image.includes(name));
 if(!sourceAdditions.length&&!imageAdditions.length)throw Error('Core133 qualification rows already enrolled; no unchanged replay');
 for(const name of sourceAdditions)if(!fs.lstatSync(path.join(root,name)).isFile())throw Error('Actual source missing: '+name);
 const source=[...current.source,...sourceAdditions],image=[...current.image,...imageAdditions];if(new Set(source).size!==source.length||new Set(image).size!==image.length)throw Error('Duplicate qualification row');
 const once=(a,b)=>{if(!text.includes(a)||text.indexOf(a)!==text.lastIndexOf(a))throw Error('Qualification list anchor drift');text=text.replace(a,b);};
 once(current.sourceAnchor,'export const SOURCE_INPUTS=Object.freeze('+JSON.stringify(source)+');');once(current.imageAnchor,'export const IMAGE_INPUTS=Object.freeze('+JSON.stringify(image)+');');
 if(sourceAdditions.some(p=>p.includes('*'))||imageAdditions.some(p=>p.includes('*')))throw Error('No wildcard qualification inputs');
 return{file,before,after:Buffer.from(crlf?text.replaceAll('\n','\r\n'):text),sourceAdditions,imageAdditions,beforeCounts:{source:current.source.length,image:current.image.length},afterCounts:{source:source.length,image:image.length}};
}
