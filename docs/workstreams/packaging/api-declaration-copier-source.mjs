// Inserted into the original API copier; not a second copy/build owner.
export const DECLARATION_SUPPORT=String.raw`
const reviewedDeclarationInputs=__INPUTS__;
const reviewedDeclarationCompilerInputs=__COMPILER__;
const reviewedDeclarationPackages=__PACKAGES__;
const packagingStat=file=>{try{return fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
function readStablePackagingFile(file,owner){
 let fd;try{
  if(fs.realpathSync(file)!==file)throw Error('Packaging input aliases another path');
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const first=fs.fstatSync(fd);if(!first.isFile()||first.nlink!==1||first.uid!==owner||first.size<1||first.size>4*1024*1024)throw Error('Unsafe packaging input');
  const raw=fs.readFileSync(fd),last=fs.fstatSync(fd),named=fs.lstatSync(file);
  if(raw.length!==first.size||!Buffer.from(raw.toString('utf8')).equals(raw)||fs.realpathSync(file)!==file||['dev','ino','size','mtimeMs','ctimeMs','uid','gid','mode','nlink'].some(k=>first[k]!==last[k]||first[k]!==named[k]))throw Error('Packaging input changed');
  return raw;
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
const declarationModule=file=>file.endsWith('.d.mts')?file.slice(0,-6)+'.mjs':file.endsWith('.d.ts')?file.slice(0,-5)+'.js':file;
export function planReviewedDeclarations({sourceRoot,destination,runtimeEntries}){
 const owner=fs.statSync(sourceRoot).uid,runtime=new Map(runtimeEntries.map(r=>[r.source,r])),types=new Map(),outputs=new Map(),compilerTypes=new Map(),packageTypes=new Map();
 const sourceFile=name=>path.join(sourceRoot,...name.split('/'));
 for(const row of reviewedDeclarationInputs){
  const source=sourceFile(row.source),target=path.join(destination,...row.target.split('/'));
  if(!within(destination,target)||types.has(source)||outputs.has(declarationModule(target)))throw Error('Duplicate or escaped reviewed declaration');
  if(row.runtimeSource){const original=runtime.get(sourceFile(row.runtimeSource));if(!original||declarationModule(target)!==original.target)throw Error('Declaration differs from original runtime target');}
  else if(row.source==='services/ingenium-api/lib/dot-v2/managed-job-contracts.d.mts'){if(row.target!=='lib/dot-v2/managed-job-contracts.d.mts')throw Error('Type-only contract target changed');}
  else if(!['packages/veyra-automation/contracts.d.ts','packages/veyra-projects/contracts.d.ts'].includes(row.source)||row.target!=='veyra-packages/'+row.source.slice('packages/'.length))throw Error('Undeclared type-only module');
  const raw=readStablePackagingFile(source,owner),entry={source,target,sourceSha256:digest(raw),raw,kind:'reviewed-raw-declaration'};types.set(source,entry);outputs.set(declarationModule(target),entry);
 }
 const context={sourceRoot,destination,owner,runtime,types,outputs,compilerTypes,packageTypes};
 const entries=[...types.values()].map(row=>{const emitted=rewriteReviewedDeclaration(row.raw.toString('utf8'),row,context);return{...row,emitted,emittedSha256:digest(emitted)};});
 const compilerInputs=reviewedDeclarationCompilerInputs.map(name=>{const source=sourceFile(name),raw=readStablePackagingFile(source,owner);return{source,target:path.join(destination,...name.slice('services/ingenium-api/'.length,-3).split('/'))+'.d.ts',sourceSha256:digest(raw),kind:'reviewed-compiler-declaration'};});
 return{entries,context,compilerInputs};
}
function resolveReviewedDeclaration(specifier,row,context){
 const {sourceRoot,destination,owner,runtime,types,outputs,compilerTypes,packageTypes}=context;
 if(!specifier.startsWith('.')){
  if(!reviewedDeclarationPackages.includes(specifier))throw Error('Undeclared declaration package: '+specifier);
  return specifier;
 }
 const existing=outputs.get(path.resolve(path.dirname(row.target),specifier));if(existing)return specifier;
 const base=path.resolve(path.dirname(row.source),specifier),candidates=[base];
 if(base.endsWith('.mjs'))candidates.push(base.slice(0,-4)+'.d.mts');if(base.endsWith('.js'))candidates.push(base.slice(0,-3)+'.ts',base.slice(0,-3)+'.d.ts');
 let target;
 for(const source of candidates){
  const declared=types.get(source);if(declared){target=declarationModule(declared.target);break;}
  const original=runtime.get(source);if(original){const typed=types.get(source.slice(0,-4)+'.d.mts');if(!typed)throw Error('Missing transitive MJS declaration: '+specifier);target=original.target;break;}
  if(source.startsWith(path.join(sourceRoot,'services/ingenium-api')+path.sep)&&source.endsWith('.ts')&&!source.endsWith('.d.ts')&&packagingStat(source)?.isFile()){
   const raw=readStablePackagingFile(source,owner),artifact=path.join(destination,path.relative(path.join(sourceRoot,'services/ingenium-api'),source).slice(0,-3)+'.d.ts');
   const dependency={source,target:artifact,sourceSha256:digest(raw)};compilerTypes.set(artifact,dependency);target=declarationModule(artifact);break;
  }
 }
 if(!target)throw Error('Missing transitive declaration: '+specifier);
 let relative=path.relative(path.dirname(row.target),target).split(path.sep).join('/');if(!relative.startsWith('.'))relative='./'+relative;return relative;
}
export function rewriteReviewedDeclaration(text,row,context){
 const syntax=ts.createSourceFile(row.source,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);if(syntax.parseDiagnostics.length)throw Error('Invalid declaration output');
 const changes=[];
 function reference(node){if(!node||!ts.isStringLiteralLike(node))throw Error('Nonliteral declaration reference');const next=resolveReviewedDeclaration(node.text,row,context);if(next!==node.text)changes.push({start:node.getStart(syntax),end:node.getEnd(),next});}
 function visit(node){
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)reference(node.moduleSpecifier);
  if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))reference(node.argument.literal);
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)throw Error('Runtime import in declaration');
  ts.forEachChild(node,visit);
 }
 visit(syntax);let emitted=text;for(const r of changes.sort((a,b)=>b.start-a.start))emitted=emitted.slice(0,r.start)+JSON.stringify(r.next)+emitted.slice(r.end);return emitted;
}
export function prepareDomainRuntimePostimages(plan){
 const current=planDomainRuntime({sourceRoot:plan.sourceRoot,destination:plan.destination});
 const identity=p=>JSON.stringify({entries:p.entries.map(r=>[r.source,r.target,r.sourceSha256,r.emittedSha256]),compiled:p.compiledRelocations,declarationCompiler:p.declarations.compilerInputs,dependencies:[...p.declarations.context.compilerTypes.values()]});
 if(identity(current)!==identity(plan))throw Error('Packaging plan/source changed before write');
 const compiled=planOriginalCompilerPostimages(current),context=current.declarations.context;
 for(const row of compiled.filter(r=>r.target.endsWith('.d.ts'))){row.emitted=rewriteReviewedDeclaration(row.emitted,row,context);row.emittedSha256=digest(row.emitted);}
 for(const row of current.declarations.compilerInputs){const before=readStablePackagingFile(row.target,context.owner).toString('utf8'),emitted=rewriteReviewedDeclaration(before,row,context);compiled.push({...row,emitted,emittedSha256:digest(emitted)});}
 const files=[...current.entries,...compiled],seen=new Set();
 for(const row of files){if(!within(current.destination,row.target)||seen.has(row.target))throw Error('Duplicate/escaped packaging output');seen.add(row.target);}
 const typeDependencies=[];
 for(const row of context.compilerTypes.values()){const output=files.find(f=>f.target===row.target),raw=output?Buffer.from(output.emitted):readStablePackagingFile(row.target,context.owner);typeDependencies.push({...row,emittedSha256:digest(raw)});}
 const manifest={schemaVersion:1,files:files.map(row=>({source:path.relative(repository,row.source).split(path.sep).join('/'),path:path.relative(current.destination,row.target).split(path.sep).join('/'),sourceSha256:row.sourceSha256,emittedSha256:row.emittedSha256,kind:row.kind??'runtime-mjs'})),typeDependencies:typeDependencies.map(row=>({source:path.relative(repository,row.source).split(path.sep).join('/'),path:path.relative(current.destination,row.target).split(path.sep).join('/'),sourceSha256:row.sourceSha256,emittedSha256:row.emittedSha256}))};
 return{...current,files,manifest};
}
`;
