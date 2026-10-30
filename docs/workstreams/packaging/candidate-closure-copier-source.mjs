// Insertion text for the existing copier, not a second copier/compiler.
export const COPIER_SUPPORT=String.raw`
// Explicit required candidate modules. This does not expand the existing roots.
const requiredCandidateRuntimeSources = __REQUIRED__;
const reviewedCompiledRuntimeSources = __COMPILED__;
export function planReviewedCompiledRelocations({sourceRoot,destination,entries}) {
  const files = new Map(entries.map(entry=>[path.resolve(entry.source),entry]));
  for(const name of requiredCandidateRuntimeSources)if(!files.has(path.join(sourceRoot,...name.split('/'))))throw Error('Required original candidate module missing: '+name);
  const rows=[];
  for(const name of reviewedCompiledRuntimeSources){
    const source=path.join(sourceRoot,...name.split('/')),raw=fs.readFileSync(source),syntax=ts.createSourceFile(source,raw.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    if(syntax.parseDiagnostics.length)throw Error('Invalid reviewed compiler input: '+name);
    const target=path.join(destination,...name.slice('services/ingenium-api/'.length,-3).split('/'))+'.js',references=[];
    function add(specifier,runtimeRequired){
      if(!ts.isStringLiteralLike(specifier)||!specifier.text.startsWith('.')||!specifier.text.endsWith('.mjs'))return;
      const dependency=files.get(path.resolve(path.dirname(source),specifier.text));
      if(!dependency){if(specifier.text.includes('/packages/')||specifier.text.includes('/tools/'))throw Error('Compiled import outside reviewed closure: '+name);return;}
      let replacement=path.relative(path.dirname(target),dependency.target).split(path.sep).join('/');if(!replacement.startsWith('.'))replacement='./'+replacement;
      if(replacement!==specifier.text)references.push({source:specifier.text,target:replacement,runtimeRequired});
    }
    function visit(node){
      if(ts.isImportDeclaration(node)&&node.moduleSpecifier){const clause=node.importClause,pureType=clause?.isTypeOnly||(!clause?.name&&clause?.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.length>0&&clause.namedBindings.elements.every(item=>item.isTypeOnly));add(node.moduleSpecifier,!pureType);}
      if(ts.isExportDeclaration(node)&&node.moduleSpecifier)add(node.moduleSpecifier,!node.isTypeOnly);
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){if(node.arguments.length!==1)throw Error('Unsupported reviewed compiled dynamic import');add(node.arguments[0],true);}
      ts.forEachChild(node,visit);
    }
    visit(syntax);if(!references.length)throw Error('Reviewed compiled relocation unexpectedly empty: '+name);
    if(new Set(references.map(r=>r.source)).size!==references.length)throw Error('Ambiguous reviewed compiler references: '+name);
    rows.push({source,target,declarationTarget:target.slice(0,-3)+'.d.ts',sourceSha256:digest(raw),references});
  }
  return rows;
}
export function rewriteReviewedCompiledModule(text,references,{runtime=false}={}){
  const syntax=ts.createSourceFile(runtime?'compiled.js':'compiled.d.ts',text,ts.ScriptTarget.Latest,true,runtime?ts.ScriptKind.JS:ts.ScriptKind.TS);
  if(syntax.parseDiagnostics.length)throw Error('Invalid original compiler output');
  const replacements=[],counts=new Map(references.map(row=>[row.source,0]));
  function reference(specifier){if(!specifier||!ts.isStringLiteralLike(specifier))return;const row=references.find(row=>row.source===specifier.text);if(!row)return;counts.set(row.source,counts.get(row.source)+1);replacements.push({start:specifier.getStart(syntax),end:specifier.getEnd(),text:JSON.stringify(row.target)});}
  function visit(node){
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)reference(node.moduleSpecifier);
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length===1)reference(node.arguments[0]);
    if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))reference(node.argument.literal);
    ts.forEachChild(node,visit);
  }
  visit(syntax);
  for(const row of references){const count=counts.get(row.source);if(count>1||(runtime&&row.runtimeRequired&&count!==1))throw Error('Reviewed compiler import occurrence mismatch: '+row.source);}
  let emitted=text;for(const row of replacements.sort((a,b)=>b.start-a.start))emitted=emitted.slice(0,row.start)+row.text+emitted.slice(row.end);
  return emitted;
}
function planOriginalCompilerPostimages(plan){
  const result=[];
  for(const row of plan.compiledRelocations){
    for(const [target,runtime]of[[row.target,true],[row.declarationTarget,false]]){
      if(!within(plan.destination,target)||fs.realpathSync(target)!==target)throw Error('Reviewed compiler output aliases another location');
      const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>4*1024*1024)throw Error('Unsafe reviewed compiler output');
      const before=fs.readFileSync(target,'utf8'),emitted=rewriteReviewedCompiledModule(before,row.references,{runtime});
      result.push({source:row.source,target,sourceSha256:row.sourceSha256,emittedSha256:digest(emitted),emitted,kind:runtime?'reviewed-ts-runtime-relocation':'reviewed-ts-declaration-relocation'});
    }
  }
  return result;
}
`;
