import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';
import{DECLARATION_SUPPORT}from'./api-declaration-copier-source.mjs';
import{reviewedDeclarationInputs,reviewedDeclarationCompilerInputs,reviewedDeclarationPackages}from'./api-declaration-closure-inventory.mjs';
export function proposeApiDeclarations(root){
 const file='services/ingenium-api/scripts/copy-domain-runtime.mjs',before=fs.readFileSync(path.join(root,file)),crlf=before.toString().includes('\r\n');let source=before.toString().replaceAll('\r\n','\n');
 const once=(a,b)=>{if(!source.includes(a)||source.indexOf(a)!==source.lastIndexOf(a))throw Error('Original copier anchor drift: '+a.slice(0,90));source=source.replace(a,b);};
 const support=DECLARATION_SUPPORT.replace('__INPUTS__',JSON.stringify(reviewedDeclarationInputs)).replace('__COMPILER__',JSON.stringify(reviewedDeclarationCompilerInputs)).replace('__PACKAGES__',JSON.stringify(reviewedDeclarationPackages));
 once('/** Compile-time closure only:',support+'\n/** Compile-time closure only:');
 once("raw=fs.readFileSync(source),syntax=ts.createSourceFile(source,raw.toString('utf8')","raw=readStablePackagingFile(source,fs.statSync(sourceRoot).uid),syntax=ts.createSourceFile(source,raw.toString('utf8')");
 once("const before=fs.readFileSync(target,'utf8'),emitted=rewriteReviewedCompiledModule","const before=readStablePackagingFile(target,fs.statSync(plan.sourceRoot).uid).toString('utf8'),emitted=rewriteReviewedCompiledModule");
 once('const raw = entry.singleton ? readSingleton(entry) : fs.readFileSync(entry.source);','const raw = entry.singleton ? readSingleton(entry) : readStablePackagingFile(entry.source, sourceOwner);');
 once('  return { destination, entries: planned, compiledRelocations };','  const declarations=planReviewedDeclarations({sourceRoot,destination,runtimeEntries:planned});\n  return { sourceRoot, destination, entries: [...planned,...declarations.entries], compiledRelocations, declarations };');
 const a=source.indexOf('export function materializeDomainRuntime(plan) {'),b=source.indexOf('\nif (process.argv[1]',a);if(a<0||b<0)throw Error('Original materializer bounds missing');
 const writer=String.raw`export function materializeDomainRuntime(plan) {
  const prepared=prepareDomainRuntimePostimages(plan),root=prepared.destination,owner=prepared.declarations.context.owner;
  const rootStat=packagingStat(root);if(rootStat&&(!rootStat.isDirectory()||rootStat.isSymbolicLink()||fs.realpathSync(root)!==root))throw Error('Unsafe runtime destination');
  const outputs=[...prepared.files.map(row=>({target:row.target,raw:Buffer.from(row.emitted)})),{target:path.join(root,'veyra-runtime-closure.json'),raw:Buffer.from(JSON.stringify(prepared.manifest,null,2)+'\n')}];
  // Validate every target and ancestor before mkdir, truncation or content writes.
  for(const row of outputs){
    if(!within(root,row.target))throw Error('Output escaped original destination');
    for(let parent=path.dirname(row.target);parent!==root;parent=path.dirname(parent)){if(!within(root,parent))throw Error('Output parent escaped original destination');const stat=packagingStat(parent);if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(parent)!==parent))throw Error('Unsafe runtime output parent');}
    const stat=packagingStat(row.target);if(stat){row.prior=stat;row.priorSha256=digest(readStablePackagingFile(row.target,owner));}
  }
  for(const row of prepared.files)if(digest(readStablePackagingFile(row.source,owner))!==row.sourceSha256)throw Error('Source changed before packaging writes');
  for(const dependency of prepared.declarations.context.compilerTypes.values()){
    if(digest(readStablePackagingFile(dependency.source,owner))!==dependency.sourceSha256)throw Error('Type dependency source changed before writes');
    if(!prepared.files.some(row=>row.target===dependency.target)){const expected=prepared.manifest.typeDependencies.find(row=>row.path===path.relative(root,dependency.target).split(path.sep).join('/'));if(!expected||digest(readStablePackagingFile(dependency.target,owner))!==expected.emittedSha256)throw Error('Type dependency artifact changed before writes');}
  }
  for(const row of outputs){const stat=packagingStat(row.target);if(row.prior?(!stat||stat.dev!==row.prior.dev||stat.ino!==row.prior.ino||digest(readStablePackagingFile(row.target,owner))!==row.priorSha256):!!stat)throw Error('Output changed before packaging writes');}
  for(const row of outputs){
    fs.mkdirSync(path.dirname(row.target),{recursive:true});let fd;
    try{
      fd=fs.openSync(row.target,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW|(row.prior?0:fs.constants.O_CREAT|fs.constants.O_EXCL),0o644);
      const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.uid!==owner||(row.prior&&(stat.dev!==row.prior.dev||stat.ino!==row.prior.ino)))throw Error('Unsafe runtime output descriptor');
      fs.ftruncateSync(fd,0);let at=0;while(at<row.raw.length){const count=fs.writeSync(fd,row.raw,at,row.raw.length-at,at);if(!Number.isSafeInteger(count)||count<1)throw Error('Runtime output write incomplete');at+=count;}fs.fchmodSync(fd,0o644);
    }finally{if(fd!==undefined)fs.closeSync(fd);}
    if(digest(readStablePackagingFile(row.target,owner))!==digest(row.raw))throw Error('Runtime output hash mismatch');
  }
  return prepared.manifest;
}
`;
 source=source.slice(0,a)+writer+source.slice(b);
 return[{path:file,before,after:Buffer.from(crlf?source.replaceAll('\n','\r\n'):source)}];
}
