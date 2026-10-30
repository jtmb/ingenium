import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const CORE_COPIER='packages/ingenium-core/scripts/copy-core-runtime.mjs';
export const PREIMAGE_SHA256='606ac8edf410a3beae4a6d664b540f219c765c8f727af3d2eeb3013bca624cfb';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function proposeCoreExplicitDestination(root){
 const before=fs.readFileSync(path.join(root,CORE_COPIER));if(hash(before)!==PREIMAGE_SHA256)throw Error('Current original Core copier preimage changed; review required');
 const crlf=before.includes(Buffer.from('\r\n'));let text=before.toString().replaceAll('\r\n','\n');
 const once=(a,b)=>{if(!text.includes(a)||text.indexOf(a)!==text.lastIndexOf(a))throw Error('Core destination anchor drift');text=text.replace(a,b);};
 once('export function planCoreRuntime({coreRoot=packageRoot}={}){\n coreRoot=fs.realpathSync(coreRoot);const destination=path.join(coreRoot,\'dist\');',String.raw`export function coreRuntimeDestination(coreRoot,value){
 const destination=value===undefined?path.join(coreRoot,'dist'):value;
 if(typeof destination!=='string'||!path.isAbsolute(destination)||path.resolve(destination)!==destination)fail('destination must be an explicit normalized absolute path');
 if(destination===path.parse(destination).root||destination===coreRoot||coreRoot.startsWith(destination+path.sep)||(destination.startsWith(coreRoot+path.sep)&&destination!==path.join(coreRoot,'dist')))fail('destination overlaps original Core source');
 // Check every existing ancestor, including absent-output parents, before mkdir.
 for(let cursor=destination;;cursor=path.dirname(cursor)){
  const stat=existing(cursor);if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(cursor)!==cursor))fail('destination ancestor alias/type');
  if(cursor===path.dirname(cursor))break;
 }
 return destination;
}
export function planCoreRuntime({coreRoot=packageRoot,destination:requestedDestination}={}){
 coreRoot=fs.realpathSync(coreRoot);const destination=coreRuntimeDestination(coreRoot,requestedDestination);`);
 once('const original=planCoreRuntime({coreRoot:plan.coreRoot});','const original=planCoreRuntime({coreRoot:plan.coreRoot,destination:plan.destination});');
 once("if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){\n const plan=planCoreRuntime();\n if(process.argv.includes('--check'))",String.raw`export function coreRuntimeCliOptions(argv){
 const result={check:false};let destinationSeen=false;
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];
  if(flag==='--check'&&!result.check){result.check=true;continue;}
  if(flag==='--destination'&&!destinationSeen){const value=argv[++i];if(!value||value.startsWith('--'))fail('missing CLI destination');result.destination=value;destinationSeen=true;continue;}
  fail('unknown or repeated CLI option');
 }
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options=coreRuntimeCliOptions(process.argv.slice(2)),plan=planCoreRuntime({destination:options.destination});
 if(options.check)`);
 const after=Buffer.from(crlf?text.replaceAll('\n','\r\n'):text);return{path:CORE_COPIER,before,after,preimageSha256:hash(before),postimageSha256:hash(after)};
}