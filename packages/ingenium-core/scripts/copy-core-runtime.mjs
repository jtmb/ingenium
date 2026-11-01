// Proposed canonical target: packages/ingenium-core/scripts/copy-core-runtime.mjs.
// Build-owned byte copier only; no helper import, database, process or runtime side effect.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isBuiltin} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const CORE_RUNTIME_FILES=Object.freeze([
 "lib/tools/learned-memory-restore.mjs",
 "lib/tools/learned-memory-restore.d.mts",
 "lib/tools/voice-attachment-restore.mjs",
 "lib/tools/voice-attachment-restore.d.mts",
 "lib/tools/workspace-context-store.mjs",
 "lib/tools/workspace-context-store.d.mts",
 "data/migrations/migration-rebuild.mjs",
 "data/migrations/migration-136.mjs",
 "data/migrations/migration-136.d.mts",
 "data/migrations/migration-137.mjs",
 "data/migrations/migration-137.d.mts",
 "lib/tools/workspace-runtime-credentials.mjs",
 "lib/tools/workspace-runtime-credentials.d.mts",
 "lib/tools/workspace-runtime-auth.mjs",
 "lib/tools/workspace-runtime-auth.d.mts"
]);
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const fail=message=>{throw Error('Original Core runtime closure unavailable: '+message);};
const existing=file=>{try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const equalStat=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs','uid','gid','mode','nlink'].every(key=>a[key]===b[key]);
function stableSource(file){
 let fd;
 try{
  if(fs.realpathSync(file)!==file)fail('source alias');
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const first=fs.fstatSync(fd);if(!first.isFile()||first.nlink!==1||first.size<1||first.size>512*1024)fail('source type/size');
  const raw=fs.readFileSync(fd),last=fs.fstatSync(fd),named=fs.lstatSync(file);
  if(raw.length!==first.size||!equalStat(first,last)||!equalStat(first,named)||fs.realpathSync(file)!==file)fail('source changed');
  if(!Buffer.from(raw.toString('utf8')).equals(raw))fail('source encoding');
  return raw;
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function validateCoreRuntimeImports(name,text){
 if(!CORE_RUNTIME_FILES.includes(name))fail('undeclared source');
 const declaration=name.endsWith('.d.mts'),syntax=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,declaration?ts.ScriptKind.TS:ts.ScriptKind.JS);
 if(syntax.parseDiagnostics.length)fail('source syntax');
 const imports=[];
 const reference=(node,typeOnly)=>{
  if(!node||!ts.isStringLiteralLike(node))fail('nonliteral import');
  const value=node.text;let target=null;
  if(value.startsWith('node:')&&isBuiltin(value))target=value;
  else if(value.startsWith('.')){target=path.posix.normalize(path.posix.join(path.posix.dirname(name),value));const compiled=name==='lib/tools/workspace-runtime-credentials.mjs'&&['lib/db.js','lib/tools/authentication.js'].includes(target);if((!CORE_RUNTIME_FILES.includes(target)&&!compiled)||(!declaration&&target.endsWith('.d.mts')))fail('relative import outside fixed helpers');}
  else if(declaration&&typeOnly&&value==='better-sqlite3')target=value;
  else fail('undeclared dependency '+value);
  imports.push({specifier:value,target,typeOnly:!!typeOnly});
 };
 function visit(node){
  if(ts.isImportDeclaration(node))reference(node.moduleSpecifier,node.importClause?.isTypeOnly);
  if(ts.isExportDeclaration(node)&&node.moduleSpecifier)reference(node.moduleSpecifier,node.isTypeOnly);
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require')))fail('runtime import/require call');
  if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))reference(node.argument.literal,true);
  ts.forEachChild(node,visit);
 }
 visit(syntax);return imports;
}
export function coreRuntimeDestination(coreRoot,value){
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
 coreRoot=fs.realpathSync(coreRoot);const destination=coreRuntimeDestination(coreRoot,requestedDestination);
 const files=CORE_RUNTIME_FILES.map(source=>{
  const input=path.join(coreRoot,...source.split('/')),raw=stableSource(input),imports=validateCoreRuntimeImports(source,raw.toString('utf8'));
  return{source,input,target:path.join(destination,...source.split('/')),bytes:raw.length,sourceSha256:digest(raw),artifactSha256:digest(raw),raw,imports};
 });
 const manifest={schemaVersion:1,kind:'original-core-explicit-runtime-closure',files:files.map(({source,bytes,sourceSha256,artifactSha256})=>({source,path:source,bytes,sourceSha256,artifactSha256}))};
 return{coreRoot,destination,files,manifest};
}
export function materializeCoreRuntime(plan){
 // Rebuild the fixed plan from original source, never accept caller-supplied bytes or target lists.
 const original=planCoreRuntime({coreRoot:plan.coreRoot,destination:plan.destination});
 if(JSON.stringify(original.manifest)!==JSON.stringify(plan.manifest))fail('source changed after planning');
 const root=original.destination;
 const rootStat=existing(root);if(rootStat&&(!rootStat.isDirectory()||rootStat.isSymbolicLink()||fs.realpathSync(root)!==root))fail('destination alias/type');
 const manifestPath=path.join(root,'veyra-core-runtime-closure.json'),manifestRaw=Buffer.from(JSON.stringify(original.manifest,null,2)+'\n');
 const outputs=[...original.files.map(row=>({target:row.target,raw:row.raw})),{target:manifestPath,raw:manifestRaw}];
 // Validate every existing target/ancestor before any write; retain failures for the original build owner.
 for(const row of outputs){
  for(let parent=path.dirname(row.target);parent!==root;parent=path.dirname(parent)){
   if(!parent.startsWith(root+path.sep))fail('output escaped Core distribution');
   const stat=existing(parent);if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(parent)!==parent))fail('output parent alias/type');
  }
  const stat=existing(row.target);if(stat){
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||fs.realpathSync(row.target)!==row.target)fail('output alias/type');
   if(!fs.readFileSync(row.target).equals(row.raw))fail('existing output differs; regenerate through original Core build');
  }
 }
 for(const row of outputs){fs.mkdirSync(path.dirname(row.target),{recursive:true});if(!existing(row.target))fs.writeFileSync(row.target,row.raw,{flag:'wx',mode:0o444});fs.chmodSync(row.target,0o444);if(digest(fs.readFileSync(row.target))!==digest(row.raw))fail('output changed');}
 return original.manifest;
}
export function coreRuntimeCliOptions(argv){
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
 if(options.check)console.log(JSON.stringify({files:plan.files.length,materialized:false,destination:plan.destination}));
 else console.log(JSON.stringify({files:materializeCoreRuntime(plan).files.length}));
}
