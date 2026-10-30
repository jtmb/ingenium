// Exactly these original TS module outputs may be referenced directly by raw MJS.
const fixedCompiledRuntimeSources=Object.freeze(['services/ingenium-api/lib/runtime-manager-auth.ts','services/ingenium-api/lib/runtime-manager-contract.ts','services/ingenium-api/lib/dot-v2/dot-original-context.ts']);
const fixedCompiledTransitiveSources=Object.freeze(["services/ingenium-api/lib/runtime-manager-auth.ts","services/ingenium-api/lib/runtime-manager-contract.ts","services/ingenium-api/lib/dot-v2/dot-original-context.ts","services/ingenium-api/lib/dot-v2/installed-dot-approved-scope.ts","services/ingenium-api/lib/runtime-manager-client.ts","services/ingenium-api/lib/runtime-placement-contract.ts","services/ingenium-api/lib/dot-v2/request-binding.ts","services/ingenium-api/lib/dot-v2/service.ts","services/ingenium-api/lib/dot-v2/repository.ts","services/ingenium-api/lib/dot-v2/schedule.ts","services/ingenium-api/lib/dot-v2/existing-jobs.ts"]);
export function planFixedCompiledRuntimeDependencies({sourceRoot,destination,runtimeEntries}){
 const owner=fs.statSync(sourceRoot).uid,api=path.join(sourceRoot,'services/ingenium-api'),config=path.join(api,'tsconfig.json'),base=path.join(sourceRoot,'tsconfig.base.json');
 const configRaw=readStablePackagingFile(config,owner),baseRaw=readStablePackagingFile(base,owner),json=ts.parseConfigFileTextToJson(config,configRaw.toString('utf8'));if(json.error)throw Error('Invalid original API compiler config');
 const parsed=ts.parseJsonConfigFileContent(json.config,ts.sys,api);if(parsed.errors.length)throw Error('Original API compiler inputs unavailable');
 const compilerInputs=new Set(parsed.fileNames.map(f=>path.resolve(f))),runtime=new Map(runtimeEntries.map(r=>[r.source,r])),files=new Map();
 function original(source){
  if(files.has(source))return files.get(source);
  if(!fixedCompiledTransitiveSources.includes(path.relative(sourceRoot,source).split(path.sep).join('/')))throw Error('Undeclared fixed compiler transitive input');
  if(!source.startsWith(api+path.sep)||!compilerInputs.has(source)||!source.endsWith('.ts')||source.endsWith('.d.ts'))throw Error('Not an original API compiled input');
  const raw=readStablePackagingFile(source,owner),target=path.join(destination,path.relative(api,source).slice(0,-3)+'.js'),row={source,target,declarationTarget:target.slice(0,-3)+'.d.ts',sourceSha256:digest(raw),references:[],closure:[]};files.set(source,row);
  const syntax=ts.createSourceFile(source,raw.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);if(syntax.parseDiagnostics.length)throw Error('Invalid fixed compiler dependency source');
  function reference(node){
   if(!node||!ts.isStringLiteralLike(node))throw Error('Nonliteral fixed compiler dependency');const value=node.text;
   if(value.startsWith('node:')||value==='ingenium-core'||/^ingenium-core\/lib\/[A-Za-z0-9_/-]+$/.test(value)){row.closure.push({specifier:value,kind:'original-platform-package'});return;}
   if(!value.startsWith('.'))throw Error('Undeclared fixed compiler dependency package: '+value);
   const name=path.resolve(path.dirname(source),value);let dependency;
   if(value.endsWith('.js')){dependency=original(name.slice(0,-3)+'.ts');row.closure.push({specifier:value,kind:'original-ts-output',source:dependency.source,target:dependency.target});return;}
   if(value.endsWith('.mjs')){dependency=runtime.get(name);if(!dependency)throw Error('Fixed compiler MJS outside original runtime closure: '+value);let replacement=path.relative(path.dirname(target),dependency.target).split(path.sep).join('/');if(!replacement.startsWith('.'))replacement='./'+replacement;if(replacement!==value)row.references.push({source:value,target:replacement,runtimeRequired:true});row.closure.push({specifier:value,kind:'original-mjs',source:dependency.source,target:dependency.target});return;}
   throw Error('Unsupported fixed compiler dependency: '+value);
  }
  function visit(n){
   if(ts.isImportDeclaration(n)){const c=n.importClause,pure=c?.isTypeOnly||(!c?.name&&c?.namedBindings&&ts.isNamedImports(c.namedBindings)&&c.namedBindings.elements.length>0&&c.namedBindings.elements.every(e=>e.isTypeOnly));if(!pure)reference(n.moduleSpecifier);}
   if(ts.isExportDeclaration(n)&&n.moduleSpecifier&&!n.isTypeOnly)reference(n.moduleSpecifier);
   if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword){if(n.arguments.length!==1)throw Error('Unsupported fixed compiler dynamic import');reference(n.arguments[0]);}
   if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='require')throw Error('Require call in fixed compiler dependency');
   ts.forEachChild(n,visit);
  }
  visit(syntax);return row;
 }
 for(const name of fixedCompiledRuntimeSources)original(path.join(sourceRoot,...name.split('/')));
 return{configSha256:digest(configRaw),baseConfigSha256:digest(baseRaw),directSources:[...fixedCompiledRuntimeSources],files:[...files.values()]};
}
export function fixedCompilerImportReadback(text,row,emitted){
 const allowed=new Set(row.closure.map(r=>emitted?(row.references.find(v=>v.source===r.specifier)?.target??r.specifier):r.specifier)),syntax=ts.createSourceFile(row.target,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=[];if(syntax.parseDiagnostics.length)throw Error('Invalid fixed compiler JS output');
 function add(n){if(!n||!ts.isStringLiteralLike(n)||!allowed.has(n.text))throw Error('Fixed compiler output imports differ from original source closure');imports.push(n.text);}
 function visit(n){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier)add(n.moduleSpecifier);if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword){if(n.arguments.length!==1)throw Error('Fixed compiler output dynamic import');add(n.arguments[0]);}if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='require')throw Error('Fixed compiler output require');ts.forEachChild(n,visit);}
 visit(syntax);return imports;
}
function prepareFixedCompiledRuntimeDependencies(plan,compiled){
 const owner=plan.declarations.context.owner;
 for(const row of plan.fixedCompiledRuntime.files){
  if(digest(readStablePackagingFile(row.source,owner))!==row.sourceSha256)throw Error('Fixed compiler dependency source changed');
  for(const [target,runtime]of[[row.target,true],[row.declarationTarget,false]]){
   if(compiled.some(r=>r.target===target))continue;
   if(!within(plan.destination,target)||fs.realpathSync(target)!==target)throw Error('Fixed compiler output alias/escape');
   const before=readStablePackagingFile(target,owner).toString('utf8');let emitted=runtime?rewriteReviewedCompiledModule(before,row.references,{runtime:true}):rewriteReviewedDeclaration(before,row,plan.declarations.context);
   compiled.push({source:row.source,target,sourceSha256:row.sourceSha256,originalCompilerSha256:digest(Buffer.from(before)),emittedSha256:digest(emitted),emitted,kind:runtime?'fixed-original-ts-runtime':'fixed-original-ts-declaration'});
  }
 }
 return plan.fixedCompiledRuntime.files.map(row=>({source:path.relative(plan.sourceRoot,row.source).split(path.sep).join('/'),sourceSha256:row.sourceSha256,target:path.relative(plan.destination,row.target).split(path.sep).join('/'),declarationTarget:path.relative(plan.destination,row.declarationTarget).split(path.sep).join('/'),closure:row.closure.map(r=>({...r,...(r.source?{source:path.relative(plan.sourceRoot,r.source).split(path.sep).join('/'),target:path.relative(plan.destination,r.target).split(path.sep).join('/')}:{})})),outputs:[row.target,row.declarationTarget].map(target=>{const r=compiled.find(f=>f.target===target);if(!r||!r.originalCompilerSha256)throw Error('Fixed compiler original readback missing');const raw=readStablePackagingFile(target,owner);if(digest(raw)!==r.originalCompilerSha256)throw Error('Fixed compiler readback changed');return{target:path.relative(plan.destination,target).split(path.sep).join('/'),originalCompilerSha256:r.originalCompilerSha256,emittedSha256:r.emittedSha256,...(target===row.target?{originalImports:fixedCompilerImportReadback(raw.toString('utf8'),row,false),emittedImports:fixedCompilerImportReadback(r.emitted,row,true)}:{})}})}));
}