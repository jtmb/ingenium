import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {CORE_RUNTIME_FILES,validateCoreRuntimeImports} from '../../../packages/ingenium-core/scripts/copy-core-runtime.mjs';
import {planDomainRuntime,rewriteReviewedCompiledModule} from '../scripts/copy-domain-runtime.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=process.env.INGENIUM_TEST_GENERATED_OUTPUT_ROOT;
if(!output||!path.isAbsolute(output)||fs.realpathSync(output)!==output)throw Error('Original owned output root required');
const destination=path.join(output,'real-gmail-ui/veyra-phase-1/coordination/domain-closure-NOT-MATERIALIZED');
assert.equal(fs.existsSync(destination),false);
const plan=planDomainRuntime({sourceRoot:root,destination});
test('actual voice compiler output resolves the same copied singleton, without a second dependency tree',()=>{
 const row=plan.compiledRelocations.find(r=>r.source===path.join(root,'services/ingenium-api/lib/voice-v2/request-context.ts'));
 assert.ok(row);const ref=row.references.find(r=>r.source==='../../../../packages/veyra-voice/session.mjs');assert.ok(ref?.runtimeRequired);
 const actual=ts.transpileModule(fs.readFileSync(row.source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,isolatedModules:true}}).outputText;
 const emitted=rewriteReviewedCompiledModule(actual,row.references,{runtime:true});
 assert.ok(!emitted.includes(ref.source));assert.ok(emitted.includes(JSON.stringify(ref.target)));
 const dependency=plan.entries.find(r=>r.target===path.resolve(path.dirname(row.target),ref.target));assert.ok(dependency);
 assert.equal(dependency.source,path.join(root,'packages/veyra-voice/session.mjs'));
 assert.notEqual(path.resolve(path.dirname(row.target),ref.source),dependency.target);
 assert.equal(fs.existsSync(destination),false);
});
test('a lost or duplicated genuine runtime import refuses packaging',()=>{
 const row=plan.compiledRelocations.find(r=>r.source.endsWith('voice-v2/request-context.ts'));
 assert.throws(()=>rewriteReviewedCompiledModule('export const x=true;',row.references,{runtime:true}),/occurrence mismatch/);
 const ref=row.references[0];const duplicate=`import {a} from ${JSON.stringify(ref.source)};\nimport {b} from ${JSON.stringify(ref.source)};`;
 assert.throws(()=>rewriteReviewedCompiledModule(duplicate,row.references,{runtime:true}),/occurrence mismatch/);
});
test('all original candidate modules and attachment metadata owners remain a single finite planned closure',()=>{
 assert.equal(plan.compiledRelocations.length,6);
 for(const name of ['candidate-bootstrap-runtime.mjs','candidate-carrier.mjs','candidate-docker-stream.mjs','candidate-loopback.mjs','candidate-original-invocation.mjs','candidate-private-plugin.mjs'])assert.equal(plan.entries.filter(r=>r.source.endsWith('/dot-v2/'+name)).length,1,name);
 for(const name of ['attachment.mjs','hosted-attachment-owner.mjs','attachment-delivery-owner.mjs'])assert.equal(plan.entries.filter(r=>r.source.endsWith('/voice-v2/'+name)).length,1,name);
 assert.equal(new Set(plan.entries.map(r=>r.target)).size,plan.entries.length);
 assert.equal(fs.existsSync(destination),false);
});
test('workspace bootstrap has one image entry and explicit independently-qualified Core/SDK dependencies',()=>{
 const entry=plan.entries.filter(r=>r.source===path.join(root,'services/ingenium-api/scripts/runtime-workspace-bootstrap.mjs'));
 assert.equal(entry.length,1);assert.equal(entry[0].target,path.join(destination,'scripts/runtime-workspace-bootstrap.mjs'));
 const dependencies=plan.installedImageDependencies;
 assert.deepEqual(dependencies.map(r=>r.installedPath).sort(),['/app/packages/ingenium-core/dist/lib/tools/workspace-runtime-auth.mjs','/app/packages/ingenium-extension/dist/scripts/mcp-server.js'].sort());
 assert.equal(dependencies.every(r=>/^[a-f0-9]{64}$/.test(r.sourceSha256)),true);
 assert.equal(fs.existsSync(destination),false);
});
test('only the exact credential owner imports compiled Core; child derivation remains crypto-only',()=>{
 assert.equal(CORE_RUNTIME_FILES.length,15);assert.equal(new Set(CORE_RUNTIME_FILES).size,15);assert.equal(CORE_RUNTIME_FILES.every(n=>typeof n==='string'),true);
 const name='lib/tools/workspace-runtime-credentials.mjs';
 assert.equal(validateCoreRuntimeImports(name,"import {getDb} from '../db.js'; import {encryptAuthSecret} from './authentication.js';").length,2);
 for(const source of ['lib/tools/workspace-runtime-auth.mjs','lib/tools/learned-memory-restore.mjs','data/migrations/migration-136.mjs'])
  assert.throws(()=>validateCoreRuntimeImports(source,"import {getDb} from '../db.js';"),/outside fixed helpers/);
 assert.throws(()=>validateCoreRuntimeImports(name,"import './agents.js';"),/outside fixed helpers/);
 assert.throws(()=>validateCoreRuntimeImports(name,"await import('../db.js');"),/runtime import/);
 const auth=validateCoreRuntimeImports('lib/tools/workspace-runtime-auth.mjs',fs.readFileSync(path.join(root,'packages/ingenium-core/lib/tools/workspace-runtime-auth.mjs'),'utf8'));
 assert.deepEqual(auth.map(r=>r.specifier),['node:crypto']);assert.equal(fs.existsSync(destination),false);
});
