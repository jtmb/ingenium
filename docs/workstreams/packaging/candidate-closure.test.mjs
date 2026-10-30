import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import test from 'node:test';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';import * as url from 'node:url';import * as crypto from 'node:crypto';import{execFileSync}from'node:child_process';
import{proposeCandidateClosure,parseContract,sourceImports}from'./candidate-closure-proposal.mjs';
import{CANDIDATE_EXECUTABLES,AUTHORITY_EXECUTABLES,BUILD_CONTRACT_INPUTS,COMPILED_RELOCATION_SOURCES,imageArtifact}from'./candidate-closure-inventory.mjs';
import{checkDeploymentLiteralGuards,literalTokens}from'./deployment-literal-guard-audit.mjs';
const root=process.env.VEYRA_CLOSURE_ROOT;if(!root)throw Error('Actual Root source required');
export const proposal=proposeCandidateClosure(root);
const ts=createRequire(path.join(root,'package.json'))('typescript'),post=p=>proposal.edits.find(e=>e.path===p)?.after.toString()??fs.readFileSync(path.join(root,p),'utf8');
const contract=parseContract(post('packages/veyra-operations/core126-image-contract.mjs'));
const copierSource=post('services/ingenium-api/scripts/copy-domain-runtime.mjs');
const context=vm.createContext({Buffer,process:{argv:[],env:{}},console});
const copier=new vm.SourceTextModule(copierSource,{context,identifier:pathToFileURL(path.join(root,'services/ingenium-api/scripts/copy-domain-runtime.mjs')).href,initializeImportMeta(meta,module){meta.url=module.identifier;}});
const modules=new Map([['node:fs',fs],['node:path',path],['node:url',url],['node:crypto',crypto],['typescript',ts]]);
await copier.link(specifier=>{const object=modules.get(specifier);if(!object)throw Error('Unexpected copier dependency: '+specifier);const names=[...new Set(['default',...Object.keys(object)])];return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,name==='default'?object:object[name]);},{context});});
await copier.evaluate();
const destination=path.resolve(process.env.TMPDIR??path.dirname(root),'candidate-closure-NOT-MATERIALIZED');
export const plan=copier.namespace.planDomainRuntime({sourceRoot:root,destination});
test('all eight new executables have exact source and image identities, no duplicate or wildcard additions',()=>{
 assert.equal(CANDIDATE_EXECUTABLES.length,8);for(const p of CANDIDATE_EXECUTABLES){assert.ok(contract.source.includes(p),p);assert.ok(contract.image.includes(imageArtifact(p)),p);}
 assert.equal(new Set(contract.source).size,contract.source.length);assert.equal(new Set(contract.image).size,contract.image.length);
 for(const p of [...proposal.addedSources,...proposal.addedImages])assert.doesNotMatch(p,/[*?]|\.\./);
 assert.deepEqual(contract.source.slice(0,proposal.original.source.length),proposal.original.source);assert.deepEqual(contract.image.slice(0,proposal.original.image.length),proposal.original.image);
});
test('new original context, approval reader, Core delegation and direct imports are explicitly covered',()=>{
 for(const p of AUTHORITY_EXECUTABLES){assert.ok(contract.source.includes(p),p);assert.ok(contract.image.includes(imageArtifact(p)),p);}
 for(const p of ['services/ingenium-api/lib/dot-v2/dot-original-context.ts','services/ingenium-api/lib/dot-v2/core126-actual-factory.ts','packages/ingenium-core/lib/tools/dot-execution-delegation.ts',...CANDIDATE_EXECUTABLES]){
  const imports=sourceImports(root,p);assert.equal(imports.parseErrors,0,p);
  for(const ref of imports.refs.filter(r=>!r.typeOnly&&r.specifier?.startsWith('.'))){
   let target=path.posix.normalize(path.posix.join(path.posix.dirname(p),ref.specifier));if(target.endsWith('.js'))target=target.slice(0,-3)+'.ts';
   if(fs.existsSync(path.join(root,target))&&!target.endsWith('.d.mts'))assert.ok(contract.source.includes(target),p+' → '+target);
  }
 }
});
test('build declarations/configs and SQL126/129/130 remain source inputs, SQL131 is not invented',()=>{
 for(const p of BUILD_CONTRACT_INPUTS)assert.ok(contract.source.includes(p),p);
 assert.ok(contract.source.includes('services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.d.mts'));
 assert.match(fs.readFileSync(path.join(root,'services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.d.mts'),'utf8'),/import type \{ResponseVerifier\} from "\.\/managed-job-contracts\.mjs"/);
 assert.ok(!contract.source.some(p=>p.includes('/131_')));
});
test('same original copier plans seven new MJS files exactly once and does not create destination',()=>{
 for(const p of CANDIDATE_EXECUTABLES.filter(p=>p.endsWith('.mjs'))){const rows=plan.entries.filter(e=>path.relative(root,e.source).split(path.sep).join('/')===p);assert.equal(rows.length,1,p);assert.equal('/app/services/ingenium-api/dist/'+path.relative(destination,rows[0].target).split(path.sep).join('/'),imageArtifact(p));}
 assert.equal(plan.compiledRelocations.length,COMPILED_RELOCATION_SOURCES.length);assert.equal(fs.existsSync(destination),false);
 assert.ok(!copierSource.includes('singletonTools = [...'));assert.equal((copierSource.match(/source: 'tools\/veyra-release\/core126-docker-binary.mjs'/g)??[]).length,1);
});
test('compiler relocation demonstrates current wrong depth and correct emitted target without tsc',()=>{
 const row=plan.compiledRelocations.find(r=>r.source.endsWith('scripts'+path.sep+'runtime-manager.ts'));
 assert.ok(row);assert.equal(row.references.length,3);
 for(const ref of row.references){const wrong=path.resolve(path.dirname(row.target),ref.source),right=path.resolve(path.dirname(row.target),ref.target);assert.notEqual(wrong,right);assert.ok(right.includes(path.join('veyra-packages','veyra-operations')));assert.ok(plan.entries.some(e=>e.target===right));}
 const input=row.references.map((r,i)=>'import {symbol'+i+'} from '+JSON.stringify(r.source)+';').join('\n');
 const output=copier.namespace.rewriteReviewedCompiledModule(input,row.references,{runtime:true});for(const ref of row.references){assert.ok(output.includes(JSON.stringify(ref.target)));assert.ok(!output.includes(JSON.stringify(ref.source)));}
 assert.throws(()=>copier.namespace.rewriteReviewedCompiledModule('',row.references,{runtime:true}),/occurrence mismatch/);
});
test('declaration imports relocate and type-only imports do not require fake runtime exports',()=>{
 const row=plan.compiledRelocations.find(r=>r.source.endsWith('core126-runtime.ts'));assert.ok(row);assert.ok(row.references.every(r=>!r.runtimeRequired));
 assert.equal(copier.namespace.rewriteReviewedCompiledModule('export const installed = true;',row.references,{runtime:true}),'export const installed = true;');
 const ref=row.references[0],decl='export type Owner = import('+JSON.stringify(ref.source)+').Core126ImageOwner;';
 assert.ok(copier.namespace.rewriteReviewedCompiledModule(decl,row.references,{runtime:false}).includes(JSON.stringify(ref.target)));
 assert.throws(()=>copier.namespace.rewriteReviewedCompiledModule('import x from '+JSON.stringify(ref.source)+';import y from '+JSON.stringify(ref.source)+';',row.references,{runtime:false}),/occurrence mismatch/);
});
test('required MJS omission fails closed before any materialization',()=>{
 const required=proposal.requiredMjs[0],entries=plan.entries.filter(e=>path.relative(root,e.source).split(path.sep).join('/')!==required);
 assert.throws(()=>copier.namespace.planReviewedCompiledRelocations({sourceRoot:root,destination,entries}),/Required original candidate module missing/);assert.equal(fs.existsSync(destination),false);
});
test('Docker verifier explicitly checks every added artifact after actual COPY, without importing runtime modules',()=>{
 const docker=post('Dockerfile');for(const p of proposal.addedImages)assert.ok(docker.includes(JSON.stringify(p)),p);
 const marker=docker.indexOf('# Require the explicit candidate/authority artifacts;');assert.ok(marker>docker.indexOf('COPY packages/ingenium-core/data/migrations/'));
 assert.doesNotMatch(docker.slice(marker,docker.indexOf('# COPY already assigns',marker)),/import\(|require\(['"]ingenium|opencode run|docker exec/);
 assert.doesNotMatch(docker,/code-server|vscode|open-vsx/);
});
test('all candidate MJS post-repair bytes parse as JavaScript and copier parses',()=>{
 for(const p of CANDIDATE_EXECUTABLES.filter(p=>p.endsWith('.mjs')))new vm.SourceTextModule(fs.readFileSync(path.join(root,p),'utf8'));
 new vm.SourceTextModule(copierSource);
});
test('317-plus statically resolvable deployment guards agree with actual/proposed source',()=>{
 const overrides=new Map(proposal.edits.map(e=>[e.path,e.after.toString()]));const audit=checkDeploymentLiteralGuards(root,overrides);
 assert.ok(audit.checks.length>=317);assert.deepEqual(audit.failures,[]);assert.ok(audit.unexamined.length>0); // Dynamic checks remain explicitly unclaimed.
});
test('regression reintroducing the obsolete socket requirement is detected, never restored',()=>{
 const overrides=new Map(proposal.edits.map(e=>[e.path,e.after.toString()]));
 const line='require_literal "$entrypoint" \'remove_verified_stale_socket /home/ingenium-vscode/vscode-data/user-data/code-server-ipc.sock "$VSCODE_UID" "$VSCODE_GID"\'\n';
 overrides.set('scripts/validate-deployment-config.sh',post('scripts/validate-deployment-config.sh')+'\n'+line);
 const failures=checkDeploymentLiteralGuards(root,overrides).failures;assert.equal(failures.length,1);assert.ok(failures[0].literal.includes('code-server-ipc.sock'));
});
test('literal audit preserves quoted dollar/escaped apostrophe and refuses shell evaluation',()=>{
 assert.deepEqual(literalTokens('require_literal "$entrypoint" \'literal "$VSCODE_UID"\'',{entrypoint:'/x'}),['require_literal','/x','literal "$VSCODE_UID"']);
 assert.deepEqual(literalTokens("'a'\\''b'"),["a'b"]);
 assert.throws(()=>literalTokens('"$(secret-command)"'),/substitution/);assert.throws(()=>literalTokens('x;evil'),/operation/);assert.throws(()=>literalTokens('"$unknown"'),/Unresolved/);
});
test('validator postimage and Docker recipe parse without executing either',()=>{
 const validator=post('scripts/validate-deployment-config.sh'),docker=post('Dockerfile'),marker=docker.indexOf('# Require the explicit candidate/authority artifacts;'),line=docker.slice(marker).split('\n').find(l=>l.startsWith('RUN node -e '));
 const run=input=>process.platform==='win32'?execFileSync('wsl',['-d','Ubuntu','-u','brajam','--','sh','-n'],{input}):execFileSync('sh',['-n'],{input});run(validator.replaceAll('\r\n','\n'));run(line.slice(4)+'\n');
});
test('all original preimages remain untouched and no build output was materialized',()=>{
 for(const e of proposal.edits)assert.ok(fs.readFileSync(path.join(root,e.path)).equals(e.before),e.path);assert.equal(fs.existsSync(destination),false);
});

test('expanded closed metadata fits the existing 64KiB candidate source-file cap without changing it',()=>{
 const bytes=Number.MAX_SAFE_INTEGER,sha='f'.repeat(64),uuid='00000000-0000-4000-8000-000000000001';
 const value={schemaVersion:1,kind:'unapproved-candidate-source-v1',imageId:'sha256:'+sha,config:{User:'appuser',WorkingDir:'/app',Entrypoint:['/app/scripts/runtime-entrypoint.sh'],Cmd:null},source:{revision:'f'.repeat(40),sha256:sha,files:contract.source.map(path=>({path,sha256:sha,bytes}))},files:contract.image.map(path=>({path,sha256:sha,bytes,uid:0,gid:0,mode:365,kind:'file'})),rawSchemaSha256:sha,probeSha256:sha,catalogSha256:sha,validUntil:bytes,selection:{runId:uuid,caseId:'hostile-project-config-excluded',nonce:uuid},canary:{organizationId:uuid,projectId:uuid,ownerUserId:uuid,workspaceId:'w'.repeat(256),principalId:uuid,jobId:uuid,agentHash:sha,promptHash:sha,projectName:'p'.repeat(256)}};
 // Budget fixture only: NOT candidate-source material or a claimed observation.
 assert.ok(Buffer.byteLength(JSON.stringify(value))<65536);
});
