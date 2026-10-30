import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {createRequire} from 'node:module';
import {CANDIDATE_EXECUTABLES,AUTHORITY_EXECUTABLES,BUILD_CONTRACT_INPUTS,COMPILED_RELOCATION_SOURCES,imageArtifact} from './candidate-closure-inventory.mjs';
import {COPIER_SUPPORT} from './candidate-closure-copier-source.mjs';
export function parseContract(text){
 const source=/export const SOURCE_INPUTS=Object\.freeze\((\[[^;]+\])\);/.exec(text),image=/export const IMAGE_INPUTS=Object\.freeze\((\[[^;]+\])\);/.exec(text);
 if(!source||!image)throw Error('Original explicit contract anchors missing');
 const parse=s=>vm.runInNewContext('('+s+')',Object.create(null),{timeout:1000});
 return{source:Array.from(parse(source[1])),image:Array.from(parse(image[1])),sourceAnchor:source[0],imageAnchor:image[0]};
}
export function proposeCandidateClosure(root){
 const edits=[];const once=(s,a,b)=>{if(!s.includes(a)||s.indexOf(a)!==s.lastIndexOf(a))throw Error('Missing/nonunique closure anchor: '+a.slice(0,100));return s.replace(a,b);};
 const read=p=>fs.readFileSync(path.join(root,p));
 const contract=read('packages/veyra-operations/core126-image-contract.mjs').toString(),original=parseContract(contract);
 const executables=[...CANDIDATE_EXECUTABLES,...AUTHORITY_EXECUTABLES];
 const addedSources=[...executables,...BUILD_CONTRACT_INPUTS].filter(p=>!original.source.includes(p));
 const addedImages=executables.map(imageArtifact).filter(p=>!original.image.includes(p));
 if(new Set([...original.source,...addedSources]).size!==original.source.length+addedSources.length||new Set([...original.image,...addedImages]).size!==original.image.length+addedImages.length)throw Error('Duplicate closure inventory');
 for(const p of [...executables,...BUILD_CONTRACT_INPUTS]){const stat=fs.lstatSync(path.join(root,p));if(!stat.isFile()||stat.isSymbolicLink())throw Error('Missing actual reviewed source: '+p);}
 const add=(file,transform)=>{const before=read(file),raw=before.toString(),crlf=raw.includes('\r\n'),normalized=raw.replaceAll('\r\n','\n'),text=transform(normalized),after=Buffer.from(crlf?text.replaceAll('\n','\r\n'):text);if(after.equals(before))throw Error('Unchanged proposal: '+file);edits.push({path:file,before,after});};
 add('packages/veyra-operations/core126-image-contract.mjs',s=>{
  s=once(s,original.sourceAnchor,'export const SOURCE_INPUTS=Object.freeze('+JSON.stringify([...original.source,...addedSources])+');');
  return once(s,original.imageAnchor,'export const IMAGE_INPUTS=Object.freeze('+JSON.stringify([...original.image,...addedImages])+');');
 });
 const requiredMjs=executables.filter(p=>p.endsWith('.mjs'));
 const support=COPIER_SUPPORT.replace('__REQUIRED__',JSON.stringify(requiredMjs)).replace('__COMPILED__',JSON.stringify(COMPILED_RELOCATION_SOURCES));
 add('services/ingenium-api/scripts/copy-domain-runtime.mjs',s=>{
  s=once(s,'/** Compile-time closure only:',support+'\n/** Compile-time closure only:');
  s=once(s,'  return { destination, entries: planned };','  const compiledRelocations = planReviewedCompiledRelocations({sourceRoot,destination,entries:planned});\n  return { destination, entries: planned, compiledRelocations };');
  s=once(s,'  for (const entry of plan.entries) {','  // Plan exact compiler postimages before writing any output. No tsc or module execution here.\n  const compiled = planOriginalCompilerPostimages(plan);\n  for (const entry of plan.entries) {');
  s=once(s,'  const manifest = { schemaVersion: 1, files: plan.entries.map(entry =>','  for (const entry of compiled) fs.writeFileSync(entry.target, entry.emitted);\n  const manifest = { schemaVersion: 1, files: [...plan.entries,...compiled].map(entry =>');
  return once(s,'{ files: plan.entries.length, destination: plan.destination }','{ files: plan.entries.length, reviewedCompilerModules: plan.compiledRelocations.length, destination: plan.destination }');
 });
 add('Dockerfile',s=>{
  // This only checks the exact compiler/copier artifacts already copied above.
  const names=addedImages;
  const script="const fs=require('node:fs');const files="+JSON.stringify(names)+";for(const file of files){const st=fs.lstatSync(file);if(fs.realpathSync(file)!==file||!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o022)||st.size<1)throw Error('Missing or mutable original candidate artifact: '+file);}";
  if(script.includes("'")){
    // POSIX single-quoted shell argument; no caller-controlled content enters this recipe.
    const quoted="'"+script.replaceAll("'","'\\''")+"'";
    return once(s,'# COPY already assigns root ownership.','# Require the explicit candidate/authority artifacts; no discovery or runtime execution.\nRUN node -e '+quoted+'\n# COPY already assigns root ownership.');
  }
  throw Error('Unexpected Docker verifier quote shape');
 });
 const validatorPath='scripts/validate-deployment-config.sh',validator=read(validatorPath).toString().replaceAll('\r\n','\n');
 const obsolete='require_literal "$entrypoint" \'remove_verified_stale_socket /home/ingenium-vscode/vscode-data/user-data/code-server-ipc.sock "$VSCODE_UID" "$VSCODE_GID"\'\n';
 // Root may already have applied its independent-review fix. Never restore it.
 const oldDirectoryGuard="require_literal \"$dockerfile\" 'install -d -o root -g root -m 0555 /usr/local/share/ingenium/opencode-managed /usr/local/share/ingenium/opencode-managed/agents /usr/local/share/ingenium/opencode-managed/plugins /usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker /etc/opencode'";
 const newDirectoryGuard=oldDirectoryGuard.replace('enforce-reserved-broker /etc/opencode','enforce-reserved-broker /usr/local/share/ingenium/opencode-managed/plugins/enforce-job-agent /etc/opencode');
 if(validator.includes(obsolete)||validator.includes(oldDirectoryGuard))add(validatorPath,s=>{
  if(s.includes(obsolete))s=once(s,obsolete,'');
  if(s.includes(oldDirectoryGuard))s=once(s,oldDirectoryGuard,newDirectoryGuard);
  return s;
 });
 return{edits,original,addedSources,addedImages,requiredMjs,executables,validatorFollowon:{obsoleteSocketRequirement:validator.includes(obsolete)?'exact obsolete requirement deletion proposed':'Root already removed obsolete requirement; no duplicate mutation',jobPluginDirectoryGuard:validator.includes(oldDirectoryGuard)?'exact guard update proposed':'Root guard already reconciled'}};
}
export function sourceImports(root,name){
 const ts=createRequire(path.join(root,'package.json'))('typescript'),source=fs.readFileSync(path.join(root,name),'utf8'),tree=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true),refs=[];
 function visit(node){
  if(ts.isImportDeclaration(node)&&node.moduleSpecifier)refs.push({specifier:node.moduleSpecifier.text,typeOnly:!!node.importClause?.isTypeOnly,names:node.importClause?.getText(tree)??null});
  if(ts.isExportDeclaration(node)&&node.moduleSpecifier)refs.push({specifier:node.moduleSpecifier.text,typeOnly:!!node.isTypeOnly,names:node.exportClause?.getText(tree)??'*'});
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)refs.push({specifier:node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0])?node.arguments[0].text:null,typeOnly:false,dynamic:true});
  ts.forEachChild(node,visit);
 }
 visit(tree);return{parseErrors:tree.parseDiagnostics.length,refs};
}
