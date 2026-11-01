import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(apiRoot, '../..');
const domains = ['projects-v2', 'memory-v2', 'customize-v2', 'dot-v2', 'voice-v2'];
const shared = ['veyra-projects', 'veyra-memory', 'veyra-automation', 'veyra-voice', 'veyra-operations'];
// Reviewed singleton only: never discover or copy the release-tools directory.
const singletonTools = [{ source: 'tools/veyra-release/core126-candidate-intent.mjs', target: 'veyra-tools/veyra-release/core126-candidate-intent.mjs' }, { source: 'tools/veyra-release/core126-docker-binary.mjs', target: 'veyra-tools/veyra-release/core126-docker-binary.mjs' },{"source":"services/ingenium-api/scripts/runtime-workspace-bootstrap.mjs","target":"scripts/runtime-workspace-bootstrap.mjs"}];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);


// Explicit required candidate modules. This does not expand the existing roots.
const requiredCandidateRuntimeSources = ["services/ingenium-api/lib/dot-v2/candidate-lifecycle-owner.mjs","services/ingenium-api/lib/dot-v2/candidate-lifecycle-original-gates.mjs","packages/veyra-operations/core126-candidate-material.mjs","services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.mjs","services/ingenium-api/lib/dot-v2/candidate-carrier.mjs","services/ingenium-api/lib/dot-v2/candidate-docker-stream.mjs","services/ingenium-api/lib/dot-v2/candidate-loopback.mjs","services/ingenium-api/lib/dot-v2/candidate-original-invocation.mjs","services/ingenium-api/lib/dot-v2/candidate-private-plugin.mjs","packages/veyra-operations/core126-image-contract.mjs","packages/veyra-operations/core126-manager-proof.mjs","services/ingenium-api/lib/dot-v2/dot-approved-scope.mjs","services/ingenium-api/lib/dot-v2/dot-job-policy.mjs","services/ingenium-api/lib/projects-v2/request-chat-source.mjs","services/ingenium-api/lib/dot-v2/managed-job-owner.mjs","services/ingenium-api/lib/dot-v2/managed-job-core-client.mjs","services/ingenium-api/lib/dot-v2/core126-broker.mjs","services/ingenium-api/lib/dot-v2/candidate-original-manager.mjs","services/ingenium-api/lib/dot-v2/candidate-response-program.mjs","services/ingenium-api/lib/dot-v2/candidate-manager-http.mjs"];
const reviewedCompiledRuntimeSources = ["services/ingenium-api/lib/runtime-manager-client.ts","services/ingenium-api/scripts/runtime-manager.ts","services/ingenium-api/lib/dot-v2/dot-original-context.ts","services/ingenium-api/lib/dot-v2/core126-installed-image-owner.ts","services/ingenium-api/lib/dot-v2/core126-actual-factory.ts","services/ingenium-api/lib/dot-v2/core126-runtime.ts","services/ingenium-api/lib/voice-v2/request-context.ts"];
export function planReviewedCompiledRelocations({sourceRoot,destination,entries}) {
  const files = new Map(entries.map(entry=>[path.resolve(entry.source),entry]));
  for(const name of requiredCandidateRuntimeSources)if(!files.has(path.join(sourceRoot,...name.split('/'))))throw Error('Required original candidate module missing: '+name);
  const rows=[];
  for(const name of reviewedCompiledRuntimeSources){
    const source=path.join(sourceRoot,...name.split('/')),raw=readStablePackagingFile(source,fs.statSync(sourceRoot).uid),syntax=ts.createSourceFile(source,raw.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
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
      const before=readStablePackagingFile(target,fs.statSync(plan.sourceRoot).uid).toString('utf8'),emitted=rewriteReviewedCompiledModule(before,row.references,{runtime});
      result.push({source:row.source,target,sourceSha256:row.sourceSha256,originalCompilerSha256:digest(Buffer.from(before)),emittedSha256:digest(emitted),emitted,kind:runtime?'reviewed-ts-runtime-relocation':'reviewed-ts-declaration-relocation'});
    }
  }
  return result;
}


const reviewedDeclarationInputs=[{"source":"services/ingenium-api/lib/projects-v2/workspace-mcp-identity.d.mts","target":"lib/projects-v2/workspace-mcp-identity.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-mcp-identity.mjs","consumer":"Fixed actual workspace capability and original placement owner contract"},{"source":"services/ingenium-api/lib/projects-v2/saved-history-store.d.mts","target":"lib/projects-v2/saved-history-store.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/saved-history-store.mjs","consumer":"Read-only saved workspace conversation integrity and pagination contract"},{"source":"services/ingenium-api/lib/dot-v2/candidate-lifecycle-owner.d.mts","target":"lib/dot-v2/candidate-lifecycle-owner.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-lifecycle-owner.mjs","consumer":"declaration of original candidate lifecycle copier output"},{"source":"services/ingenium-api/lib/dot-v2/candidate-lifecycle-original-gates.d.mts","target":"lib/dot-v2/candidate-lifecycle-original-gates.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-lifecycle-original-gates.mjs","consumer":"declaration of original candidate lifecycle copier output"},{"source":"services/ingenium-api/lib/voice-v2/raw-assistant-wire.d.mts","target":"lib/voice-v2/raw-assistant-wire.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/raw-assistant-wire.mjs","consumer":"declaration of concrete original raw assistant wire copier output"},{"source":"packages/veyra-automation/contracts.d.ts","target":"veyra-packages/veyra-automation/contracts.d.ts","runtimeSource":null,"consumer":"transitive shared type contract"},{"source":"packages/veyra-memory/context.d.mts","target":"veyra-packages/veyra-memory/context.d.mts","runtimeSource":"packages/veyra-memory/context.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-operations/core126-agent-material.d.mts","target":"veyra-packages/veyra-operations/core126-agent-material.d.mts","runtimeSource":"packages/veyra-operations/core126-agent-material.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-operations/core126-candidate-material.d.mts","target":"veyra-packages/veyra-operations/core126-candidate-material.d.mts","runtimeSource":"packages/veyra-operations/core126-candidate-material.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-operations/core126-candidate-observation.d.mts","target":"veyra-packages/veyra-operations/core126-candidate-observation.d.mts","runtimeSource":"packages/veyra-operations/core126-candidate-observation.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-operations/core126-image-contract.d.mts","target":"veyra-packages/veyra-operations/core126-image-contract.d.mts","runtimeSource":"packages/veyra-operations/core126-image-contract.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-operations/core126-image-owner.d.mts","target":"veyra-packages/veyra-operations/core126-image-owner.d.mts","runtimeSource":"packages/veyra-operations/core126-image-owner.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-operations/core126-job-bootstrap.d.mts","target":"veyra-packages/veyra-operations/core126-job-bootstrap.d.mts","runtimeSource":"packages/veyra-operations/core126-job-bootstrap.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-operations/core126-job-plugin.d.mts","target":"veyra-packages/veyra-operations/core126-job-plugin.d.mts","runtimeSource":"packages/veyra-operations/core126-job-plugin.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-operations/core126-manager-proof.d.mts","target":"veyra-packages/veyra-operations/core126-manager-proof.d.mts","runtimeSource":"packages/veyra-operations/core126-manager-proof.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-projects/context.d.mts","target":"veyra-packages/veyra-projects/context.d.mts","runtimeSource":"packages/veyra-projects/context.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-projects/contracts.d.ts","target":"veyra-packages/veyra-projects/contracts.d.ts","runtimeSource":null,"consumer":"transitive shared type contract"},{"source":"packages/veyra-projects/domain.d.mts","target":"veyra-packages/veyra-projects/domain.d.mts","runtimeSource":"packages/veyra-projects/domain.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"packages/veyra-voice/session.d.mts","target":"veyra-packages/veyra-voice/session.d.mts","runtimeSource":"packages/veyra-voice/session.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.d.mts","target":"lib/dot-v2/candidate-bootstrap-runtime.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/candidate-carrier.d.mts","target":"lib/dot-v2/candidate-carrier.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-carrier.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/candidate-docker-stream.d.mts","target":"lib/dot-v2/candidate-docker-stream.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-docker-stream.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/candidate-loopback.d.mts","target":"lib/dot-v2/candidate-loopback.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-loopback.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/candidate-original-invocation.d.mts","target":"lib/dot-v2/candidate-original-invocation.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-original-invocation.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/candidate-private-plugin.d.mts","target":"lib/dot-v2/candidate-private-plugin.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-private-plugin.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/core126-broker.d.mts","target":"lib/dot-v2/core126-broker.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/core126-broker.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/core126-http.d.mts","target":"lib/dot-v2/core126-http.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/core126-http.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/core126-owner.d.mts","target":"lib/dot-v2/core126-owner.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/core126-owner.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/core126-purpose.d.mts","target":"lib/dot-v2/core126-purpose.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/core126-purpose.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/dot-approved-scope.d.mts","target":"lib/dot-v2/dot-approved-scope.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/dot-approved-scope.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/dot-job-policy.d.mts","target":"lib/dot-v2/dot-job-policy.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/dot-job-policy.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/job-bootstrap-frame.d.mts","target":"lib/dot-v2/job-bootstrap-frame.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/job-bootstrap-frame.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/job-bootstrap-runtime.d.mts","target":"lib/dot-v2/job-bootstrap-runtime.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/job-bootstrap-runtime.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/job-original-authority.d.mts","target":"lib/dot-v2/job-original-authority.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/job-original-authority.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/managed-dot-execution.d.mts","target":"lib/dot-v2/managed-dot-execution.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/managed-dot-execution.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/managed-job-child.d.mts","target":"lib/dot-v2/managed-job-child.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/managed-job-child.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/managed-job-contracts.d.mts","target":"lib/dot-v2/managed-job-contracts.d.mts","runtimeSource":null,"consumer":"15 actual direct type references"},{"source":"services/ingenium-api/lib/dot-v2/managed-job-core-client.d.mts","target":"lib/dot-v2/managed-job-core-client.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/managed-job-core-client.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/dot-v2/managed-job-owner.d.mts","target":"lib/dot-v2/managed-job-owner.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/managed-job-owner.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/adapters.d.mts","target":"lib/memory-v2/adapters.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/adapters.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/bounded-snapshot.d.mts","target":"lib/memory-v2/bounded-snapshot.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/bounded-snapshot.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/http.d.mts","target":"lib/memory-v2/http.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/http.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/inspection.d.mts","target":"lib/memory-v2/inspection.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/inspection.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/jobs.d.mts","target":"lib/memory-v2/jobs.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/jobs.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/lifecycle.d.mts","target":"lib/memory-v2/lifecycle.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/lifecycle.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/opencode-context-pair.d.mts","target":"lib/memory-v2/opencode-context-pair.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/opencode-context-pair.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/opencode-snapshot.d.mts","target":"lib/memory-v2/opencode-snapshot.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/opencode-snapshot.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/recall-availability.d.mts","target":"lib/memory-v2/recall-availability.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/recall-availability.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/request-policy.d.mts","target":"lib/memory-v2/request-policy.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/request-policy.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/memory-v2/source-state.d.mts","target":"lib/memory-v2/source-state.d.mts","runtimeSource":"services/ingenium-api/lib/memory-v2/source-state.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/canonical-chat-binding.d.mts","target":"lib/projects-v2/canonical-chat-binding.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/canonical-chat-binding.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/catalog.d.mts","target":"lib/projects-v2/catalog.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/catalog.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/execution.d.mts","target":"lib/projects-v2/execution.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/execution.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/handlers.d.mts","target":"lib/projects-v2/handlers.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/handlers.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/installation.d.mts","target":"lib/projects-v2/installation.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/installation.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/migration.d.mts","target":"lib/projects-v2/migration.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/migration.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/native-catalog.d.mts","target":"lib/projects-v2/native-catalog.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/native-catalog.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/native-handlers.d.mts","target":"lib/projects-v2/native-handlers.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/native-handlers.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/native-transport.d.mts","target":"lib/projects-v2/native-transport.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/native-transport.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/private-workspace-policy.d.mts","target":"lib/projects-v2/private-workspace-policy.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/private-workspace-policy.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/reads.d.mts","target":"lib/projects-v2/reads.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/reads.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/request-chat-source.d.mts","target":"lib/projects-v2/request-chat-source.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/request-chat-source.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/projects-v2/request-execution-owner.d.mts","target":"lib/projects-v2/request-execution-owner.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/request-execution-owner.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/attachment-delivery-owner.d.mts","target":"lib/voice-v2/attachment-delivery-owner.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/attachment-delivery-owner.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/core-operations.d.mts","target":"lib/voice-v2/core-operations.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/core-operations.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/current-agent.d.mts","target":"lib/voice-v2/current-agent.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/current-agent.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/hosted-lifecycle.d.mts","target":"lib/voice-v2/hosted-lifecycle.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/hosted-lifecycle.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/linux-cpu-admission.d.mts","target":"lib/voice-v2/linux-cpu-admission.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/linux-cpu-admission.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/managed-cpu-speech.d.mts","target":"lib/voice-v2/managed-cpu-speech.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/managed-cpu-speech.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/managed-profile.d.mts","target":"lib/voice-v2/managed-profile.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/managed-profile.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/managed-supervisor.d.mts","target":"lib/voice-v2/managed-supervisor.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/managed-supervisor.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"tools/veyra-release/core126-candidate-intent.d.mts","target":"veyra-tools/veyra-release/core126-candidate-intent.d.mts","runtimeSource":"tools/veyra-release/core126-candidate-intent.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"tools/veyra-release/core126-docker-binary.d.mts","target":"veyra-tools/veyra-release/core126-docker-binary.d.mts","runtimeSource":"tools/veyra-release/core126-docker-binary.mjs","consumer":"declaration of concrete original copier MJS output"},{"source":"services/ingenium-api/lib/voice-v2/attached-verbatim-policy.d.mts","target":"lib/voice-v2/attached-verbatim-policy.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/attached-verbatim-policy.mjs","consumer":"Declaration of genuine retained current-agent call DATA policy/protocol runtime"},{"source":"services/ingenium-api/lib/voice-v2/attached-call-protocol.d.mts","target":"lib/voice-v2/attached-call-protocol.d.mts","runtimeSource":"services/ingenium-api/lib/voice-v2/attached-call-protocol.mjs","consumer":"Declaration of genuine retained current-agent call DATA policy/protocol runtime"},{"source":"services/ingenium-api/lib/dot-v2/candidate-original-manager.d.mts","target":"lib/dot-v2/candidate-original-manager.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-original-manager.mjs","consumer":"Declaration of fixed genuine original-manager custody and finite response program"},{"source":"services/ingenium-api/lib/dot-v2/candidate-response-program.d.mts","target":"lib/dot-v2/candidate-response-program.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-response-program.mjs","consumer":"Declaration of fixed genuine original-manager custody and finite response program"},{"source":"services/ingenium-api/lib/dot-v2/candidate-manager-http.d.mts","target":"lib/dot-v2/candidate-manager-http.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-manager-http.mjs","consumer":"declaration of fixed original manager HTTP runtime, positive physical constructors still closed"},{"source":"services/ingenium-api/lib/projects-v2/projectless-context.d.mts","target":"lib/projects-v2/projectless-context.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/projectless-context.mjs","consumer":"Original scoped workspace-v2 runtime/Context contract"},{"source":"services/ingenium-api/lib/projects-v2/workspace-v2-image.d.mts","target":"lib/projects-v2/workspace-v2-image.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-v2-image.mjs","consumer":"Original scoped workspace-v2 runtime/Context contract"},{"source":"services/ingenium-api/lib/projects-v2/workspace-manager-wire.d.mts","target":"lib/projects-v2/workspace-manager-wire.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-manager-wire.mjs","consumer":"Original scoped workspace-v2 runtime/Context contract"},{"source":"services/ingenium-api/lib/projects-v2/workspace-v2-control.d.mts","target":"lib/projects-v2/workspace-v2-control.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-v2-control.mjs","consumer":"Original scoped workspace-v2 runtime/Context contract"},{"source":"services/ingenium-api/lib/projects-v2/workspace-v2-placement.d.mts","target":"lib/projects-v2/workspace-v2-placement.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-v2-placement.mjs","consumer":"Original scoped workspace-v2 runtime/Context contract"},{"source":"services/ingenium-api/lib/projects-v2/workspace-v2-mcp.d.mts","target":"lib/projects-v2/workspace-v2-mcp.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-v2-mcp.mjs","consumer":"Original scoped workspace-v2 runtime/Context contract"},{"source":"services/ingenium-api/lib/projects-v2/workspace-v2-opencode.d.mts","target":"lib/projects-v2/workspace-v2-opencode.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-v2-opencode.mjs","consumer":"Original scoped workspace-v2 runtime/Context contract"},{"source":"services/ingenium-api/lib/projects-v2/workspace-v2-gateway.d.mts","target":"lib/projects-v2/workspace-v2-gateway.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-v2-gateway.mjs","consumer":"Original scoped workspace-v2 runtime/Context contract"},{"source":"services/ingenium-api/lib/projects-v2/workspace-chat-binding.d.mts","target":"lib/projects-v2/workspace-chat-binding.d.mts","runtimeSource":"services/ingenium-api/lib/projects-v2/workspace-chat-binding.mjs","consumer":"Canonical original workspace Context/engine binding; distinct IDs and no generation substitution"},{"source":"services/ingenium-api/lib/dot-v2/manager-process-source.d.mts","target":"lib/dot-v2/manager-process-source.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/manager-process-source.mjs","consumer":"Actual manager process/backend and original HTTP connection observations; separate Core/image execution approval required"},{"source":"services/ingenium-api/lib/dot-v2/manager-peer-source.d.mts","target":"lib/dot-v2/manager-peer-source.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/manager-peer-source.mjs","consumer":"Actual manager process/backend and original HTTP connection observations; separate Core/image execution approval required"},{"source":"services/ingenium-api/lib/dot-v2/manager-connection-source.d.mts","target":"lib/dot-v2/manager-connection-source.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/manager-connection-source.mjs","consumer":"Original API-side fixed manager connection observation; no candidate execution grant"},{"source":"services/ingenium-api/lib/dot-v2/candidate-control-context.d.mts","target":"lib/dot-v2/candidate-control-context.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-control-context.mjs","consumer":"Genuine negative-only original Core candidate control; no execution or physical retirement authority"},{"source":"services/ingenium-api/lib/dot-v2/candidate-rpc-identity.d.mts","target":"lib/dot-v2/candidate-rpc-identity.d.mts","runtimeSource":"services/ingenium-api/lib/dot-v2/candidate-rpc-identity.mjs","consumer":"Original pending candidate RPC constructors, still closed until genuine source/facts/withdrawal composition"}];
const reviewedDeclarationCompilerInputs=["services/ingenium-api/lib/dot-v2/commands.ts","services/ingenium-api/lib/dot-v2/core-binding.ts","services/ingenium-api/lib/dot-v2/existing-jobs.ts","services/ingenium-api/lib/dot-v2/installed-dot-scheduler.ts","services/ingenium-api/lib/dot-v2/proactive.ts","services/ingenium-api/lib/dot-v2/repository.ts","services/ingenium-api/lib/dot-v2/request-binding.ts","services/ingenium-api/lib/dot-v2/router.ts","services/ingenium-api/lib/dot-v2/schedule.ts","services/ingenium-api/lib/dot-v2/service.ts","services/ingenium-api/lib/dot-v2/installed-dot-http.ts","services/ingenium-api/lib/dot-v2/request-session.ts","services/ingenium-api/lib/projects-v2/request-catalog.ts"];
const reviewedDeclarationPackages=["better-sqlite3","express","ingenium-core","ingenium-core/lib/tools/voice-operation-ledger","ingenium-core/lib/tools/runtime-original-provision","node:buffer","node:child_process","node:http","node:stream","express-serve-static-core"];
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
// Exactly these original TS module outputs may be referenced directly by raw MJS.
const fixedCompiledRuntimeSources=Object.freeze(["services/ingenium-api/lib/projects-v2/workspace-mcp-memory-owner.ts","services/ingenium-api/lib/runtime-manager-auth.ts","services/ingenium-api/lib/runtime-manager-contract.ts","services/ingenium-api/lib/dot-v2/dot-original-context.ts","services/ingenium-api/lib/request-identity.ts","services/ingenium-api/lib/runtime-mode.ts","services/ingenium-api/lib/runtime-manager-client.ts","services/ingenium-api/lib/runtime-provisioner.ts","services/ingenium-api/lib/dot-v2/core126-installed-image-owner.ts","services/ingenium-api/lib/runtime-opencode-context.ts","services/ingenium-api/lib/projects-v2/request-execution.ts","services/ingenium-api/lib/opencode-client.ts"]);
const fixedCompiledTransitiveSources=Object.freeze(["services/ingenium-api/lib/projects-v2/workspace-mcp-memory-owner.ts","services/ingenium-api/lib/memory-v2/core-session.ts","services/ingenium-api/lib/memory-v2/recall-availability.ts","services/ingenium-api/lib/runtime-manager-auth.ts","services/ingenium-api/lib/runtime-manager-contract.ts","services/ingenium-api/lib/dot-v2/dot-original-context.ts","services/ingenium-api/lib/dot-v2/installed-dot-approved-scope.ts","services/ingenium-api/lib/runtime-manager-client.ts","services/ingenium-api/lib/runtime-placement-contract.ts","services/ingenium-api/lib/dot-v2/request-binding.ts","services/ingenium-api/lib/dot-v2/service.ts","services/ingenium-api/lib/dot-v2/repository.ts","services/ingenium-api/lib/dot-v2/schedule.ts","services/ingenium-api/lib/dot-v2/existing-jobs.ts","services/ingenium-api/lib/request-identity.ts","services/ingenium-api/lib/middleware/auth.ts","services/ingenium-api/lib/middleware/errors.ts","services/ingenium-api/lib/middleware/api-token.ts","services/ingenium-api/lib/runtime-gateway-auth.ts","services/ingenium-api/lib/mcp-report-auth.ts","services/ingenium-api/lib/runtime-mode.ts","services/ingenium-api/lib/runtime-provisioner.ts","services/ingenium-api/lib/dot-v2/core126-installed-image-owner.ts","services/ingenium-api/lib/runtime-opencode-context.ts","services/ingenium-api/lib/projects-v2/request-execution.ts","services/ingenium-api/lib/authorization-policy.ts","services/ingenium-api/config/index.ts","services/ingenium-api/lib/browser-safe-scalars.ts","services/ingenium-api/lib/chat-model-variants.ts","services/ingenium-api/lib/chat-provider-catalog.ts","services/ingenium-api/lib/opencode-client.ts","services/ingenium-api/lib/runtime-placement.ts","services/ingenium-api/lib/synthesis-provider-resolution.ts","services/ingenium-api/lib/voice-v2/attachment-delivery-binding.ts","services/ingenium-api/lib/voice-v2/request-context.ts","services/ingenium-api/lib/dot-v2/core126-runtime.ts","services/ingenium-api/lib/dot-v2/core126-actual-factory.ts","services/ingenium-api/lib/dot-v2/core126-provider-resolution.ts","services/ingenium-api/lib/job-native-provider.ts","services/ingenium-api/lib/job-response-verification.ts","services/ingenium-api/lib/dot-v2/core126-broker.ts"]);
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
   const reviewedPackages={'services/ingenium-api/lib/middleware/auth.ts':['express'],'services/ingenium-api/lib/middleware/errors.ts':['express','zod'],'services/ingenium-api/lib/projects-v2/workspace-mcp-memory-owner.ts':['zod']};
   if(reviewedPackages[path.relative(sourceRoot,source).split(path.sep).join('/')]?.includes(value)){row.closure.push({specifier:value,kind:'original-locked-api-package'});return;}
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
export function prepareDomainRuntimePostimages(plan){
 const current=planDomainRuntime({sourceRoot:plan.sourceRoot,destination:plan.destination});
 const identity=p=>JSON.stringify({installedImageDependencies:p.installedImageDependencies,entries:p.entries.map(r=>[r.source,r.target,r.sourceSha256,r.emittedSha256]),compiled:p.compiledRelocations,fixed:p.fixedCompiledRuntime,declarationCompiler:p.declarations.compilerInputs,dependencies:[...p.declarations.context.compilerTypes.values()]});
 if(identity(current)!==identity(plan))throw Error('Packaging plan/source changed before write');
 const compiled=planOriginalCompilerPostimages(current),context=current.declarations.context;
 for(const row of compiled.filter(r=>r.target.endsWith('.d.ts'))){row.emitted=rewriteReviewedDeclaration(row.emitted,row,context);row.emittedSha256=digest(row.emitted);}
 const fixedCompilerReadback=prepareFixedCompiledRuntimeDependencies(current,compiled);
 for(const row of current.declarations.compilerInputs){if(compiled.some(r=>r.target===row.target))continue;const before=readStablePackagingFile(row.target,context.owner).toString('utf8'),emitted=rewriteReviewedDeclaration(before,row,context);compiled.push({...row,emitted,emittedSha256:digest(emitted)});}
 const files=[...current.entries,...compiled],seen=new Set();
 for(const row of files){if(!within(current.destination,row.target)||seen.has(row.target))throw Error('Duplicate/escaped packaging output');seen.add(row.target);}
 const typeDependencies=[];
 for(const row of context.compilerTypes.values()){const output=files.find(f=>f.target===row.target),raw=output?Buffer.from(output.emitted):readStablePackagingFile(row.target,context.owner);typeDependencies.push({...row,emittedSha256:digest(raw)});}
 const manifest={schemaVersion:1,installedImageDependencies:current.installedImageDependencies,fixedCompilerReadback,fixedCompilerConfig:{configSha256:current.fixedCompiledRuntime.configSha256,baseConfigSha256:current.fixedCompiledRuntime.baseConfigSha256},files:files.map(row=>({source:path.relative(repository,row.source).split(path.sep).join('/'),path:path.relative(current.destination,row.target).split(path.sep).join('/'),sourceSha256:row.sourceSha256,emittedSha256:row.emittedSha256,kind:row.kind??'runtime-mjs'})),typeDependencies:typeDependencies.map(row=>({source:path.relative(repository,row.source).split(path.sep).join('/'),path:path.relative(current.destination,row.target).split(path.sep).join('/'),sourceSha256:row.sourceSha256,emittedSha256:row.emittedSha256}))};
 return{...current,files,manifest};
}

/** Compile-time closure only: never reads runtime data or discovers arbitrary files. */
export function planDomainRuntime({ sourceRoot = repository, destination = path.join(apiRoot, 'dist') } = {}) {
  sourceRoot = fs.realpathSync(sourceRoot);
  destination = path.resolve(destination);
  const roots = [
    ...domains.map(name => ({ source: path.join(sourceRoot, 'services/ingenium-api/lib', name), target: path.join(destination, 'lib', name) })),
    ...shared.map(name => ({ source: path.join(sourceRoot, 'packages', name), target: path.join(destination, 'veyra-packages', name) })),
  ].filter(root => fs.existsSync(root.source));
  const files = new Map();
  function add(directory, root) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Runtime closure does not follow symlinks');
      if (entry.isDirectory()) add(full, root);
      else if (entry.isFile() && entry.name.endsWith('.mjs') && !/\.(test|node)\.mjs$/.test(entry.name)) {
        const canonical = fs.realpathSync(full);
        if (!within(root.source, canonical)) throw new Error('Runtime source escaped declared root');
        files.set(canonical, { source: canonical, target: path.join(root.target, path.relative(root.source, canonical)) });
      }
    }
  }
  for (const root of roots) add(root.source, root);
  const sourceOwner = fs.statSync(sourceRoot).uid;
  const checkSingleton = stat => {
    if (!stat.isFile() || stat.isSymbolicLink?.() || stat.nlink !== 1 || !Number.isSafeInteger(sourceOwner) || stat.uid !== sourceOwner || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > 65536) throw new Error('Unsafe reviewed runtime singleton');
  };
  const readSingleton = entry => {
    let fd;
    try {
      if (fs.realpathSync(entry.source) !== entry.source) throw new Error('Runtime singleton aliases another source');
      fd = fs.openSync(entry.source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const first = fs.fstatSync(fd); checkSingleton(first);
      const raw = fs.readFileSync(fd), last = fs.fstatSync(fd), current = fs.lstatSync(entry.source);
      checkSingleton(last); checkSingleton(current);
      if (raw.length !== first.size || fs.realpathSync(entry.source) !== entry.source || ['dev','ino','size','mtimeMs','uid','gid','mode','nlink'].some(key => first[key] !== last[key] || first[key] !== current[key])) throw new Error('Runtime singleton changed during read');
      return raw;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  for (const item of singletonTools) {
    const source = path.join(sourceRoot, ...item.source.split('/'));
    let stat;
    try { stat = fs.lstatSync(source); } catch (error) { if (error.code === 'ENOENT' && item.source !== 'services/ingenium-api/scripts/runtime-workspace-bootstrap.mjs') continue; throw error; }
    checkSingleton(stat);
    const canonical = fs.realpathSync(source);
    if (canonical !== source || !within(sourceRoot, canonical)) throw new Error('Runtime singleton escaped reviewed source');
    files.set(canonical, { source: canonical, target: path.join(destination, ...item.target.split('/')), singleton: true });
  }
  const fixedCompiledRuntime=planFixedCompiledRuntimeDependencies({sourceRoot,destination,runtimeEntries:[...files.values()]});
  const directCompiled=new Map(fixedCompiledRuntime.files.filter(r=>fixedCompiledRuntime.directSources.includes(path.relative(sourceRoot,r.source).split(path.sep).join('/'))).map(r=>[r.source.slice(0,-3)+'.js',r]));
  const planned = [];
  for (const entry of files.values()) {
    const raw = entry.singleton ? readSingleton(entry) : readStablePackagingFile(entry.source, sourceOwner);
    const text = raw.toString('utf8');
    const syntax = ts.createSourceFile(entry.source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const replacements = [];
    function reference(specifier) {
      if (!specifier || !ts.isStringLiteralLike(specifier)) throw new Error('Runtime imports must be static strings');
      const value = specifier.text;
      if (value.startsWith('node:') || value === 'ingenium-core') return;
      const sourceName=path.relative(sourceRoot,entry.source).split(path.sep).join('/');
      if(['services/ingenium-api/lib/projects-v2/workspace-v2-control.mjs','services/ingenium-api/lib/projects-v2/workspace-v2-placement.mjs','services/ingenium-api/lib/projects-v2/workspace-mcp-identity.mjs'].includes(sourceName)
        &&value==='ingenium-core/lib/tools/runtime-original-provision')return;
      // This one image-entry dependency is pure crypto, never Core DB authority.
      // Its exact original source hash is carried into the packaging manifest;
      // actual /app resolution still requires independent image qualification.
      if(sourceName==='services/ingenium-api/scripts/runtime-workspace-bootstrap.mjs'
        &&['/app/packages/ingenium-core/dist/lib/tools/workspace-runtime-auth.mjs','/app/packages/ingenium-extension/dist/scripts/mcp-server.js'].includes(value))return;

      if (!value.startsWith('.')) throw new Error('Undeclared runtime package import: ' + value);
      const source = path.resolve(path.dirname(entry.source), value);
      const dependency = files.get(source) ?? directCompiled.get(source);
      if (!dependency) throw new Error('Runtime import is outside reviewed closure: ' + value);
      let relative = path.relative(path.dirname(entry.target), dependency.target).split(path.sep).join('/');
      if (!relative.startsWith('.')) relative = './' + relative;
      replacements.push({ start: specifier.getStart(syntax), end: specifier.getEnd(), value: JSON.stringify(relative) });
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) reference(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1) throw new Error('Unsupported dynamic runtime import');
        reference(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    let emitted = text;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) emitted = emitted.slice(0, replacement.start) + replacement.value + emitted.slice(replacement.end);
    planned.push({ ...entry, sourceSha256: digest(raw), emittedSha256: digest(emitted), emitted });
  }
  const compiledRelocations = planReviewedCompiledRelocations({sourceRoot,destination,entries:planned});
  const declarations=planReviewedDeclarations({sourceRoot,destination,runtimeEntries:planned});
  const coreAuthSource=path.join(sourceRoot,'packages/ingenium-core/lib/tools/workspace-runtime-auth.mjs');
  const installedImageDependencies=[{consumer:'scripts/runtime-workspace-bootstrap.mjs',source:'packages/ingenium-core/lib/tools/workspace-runtime-auth.mjs',
    installedPath:'/app/packages/ingenium-core/dist/lib/tools/workspace-runtime-auth.mjs',sourceSha256:digest(readStablePackagingFile(coreAuthSource,sourceOwner)),
    authority:'pure domain-separated credential derivation; image qualification required'},
    {consumer:'scripts/runtime-workspace-bootstrap.mjs',source:'packages/ingenium-extension/scripts/mcp-server.ts',installedPath:'/app/packages/ingenium-extension/dist/scripts/mcp-server.js',
      sourceSha256:digest(readStablePackagingFile(path.join(sourceRoot,'packages/ingenium-extension/scripts/mcp-server.ts'),sourceOwner)),sourceKind:'original-compiled-extension-entry',authority:'actual SDK bootstrap export; compiled image qualification required'}];
  return { sourceRoot, destination, entries: [...planned,...declarations.entries], compiledRelocations, fixedCompiledRuntime, declarations, installedImageDependencies };
}

export function materializeDomainRuntime(plan) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = planDomainRuntime();
  if (process.argv.includes('--check')) console.log(JSON.stringify({ files: plan.entries.length, reviewedCompilerModules: plan.compiledRelocations.length, destination: plan.destination }));
  else console.log(JSON.stringify({ files: materializeDomainRuntime(plan).files.length, destination: plan.destination }));
}