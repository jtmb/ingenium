import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import vm from'node:vm';import test from'node:test';import * as crypto from'node:crypto';import * as modules from'node:module';import * as urls from'node:url';import{execFileSync}from'node:child_process';
import{CORE_HELPERS,CORE_COPIER,proposeCoreRuntime}from'./core-runtime-proposal.mjs';import{parseContract}from'./candidate-closure-proposal.mjs';
const root=process.env.VEYRA_CORE_AUDIT_ROOT;if(!root)throw Error('Actual Root source required');
export const proposal=proposeCoreRuntime(root);const core=path.join(root,'packages/ingenium-core'),destination=path.join(core,'dist'),ts=modules.createRequire(path.join(root,'package.json'))('typescript');
const post=name=>proposal.edits.find(e=>e.path===name)?.after.toString()??fs.readFileSync(path.join(root,name),'utf8'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const copierSource=post(CORE_COPIER);
async function load(io=fs){
 const context=vm.createContext({Buffer,process:{argv:[],env:{}},console});
 const mod=new vm.SourceTextModule(copierSource,{context,identifier:urls.pathToFileURL(path.join(root,CORE_COPIER)).href,initializeImportMeta(meta,m){meta.url=m.identifier;}});
 const deps=new Map([['node:fs',io],['node:path',path],['node:crypto',crypto],['node:module',modules],['node:url',urls],['typescript',ts]]);
 await mod.link(name=>{const object=deps.get(name);if(!object)throw Error('Unexpected build-tool import');const names=[...new Set(['default',...Object.keys(object)])];return new vm.SyntheticModule(names,function(){for(const key of names)this.setExport(key,key==='default'?object:object[key]);},{context});});await mod.evaluate();return mod.namespace;
}
export const copier=await load(),plan=copier.planCoreRuntime({coreRoot:core});
const actualOutput=path.join(destination,'lib/tools/backups.js');
export const originalOutputWitness=(()=>{
 if(!fs.existsSync(actualOutput))return{exists:false,note:'Original Core output absent; no build performed'};
 const raw=fs.readFileSync(actualOutput),owner=modules.createRequire(actualOutput),tree=ts.createSourceFile(actualOutput,raw.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),observedRestoreImports=[];
 for(const statement of tree.statements)if(ts.isImportDeclaration(statement)&&statement.moduleSpecifier.text.endsWith('-restore.mjs'))observedRestoreImports.push(statement.moduleSpecifier.text);
 const source=ts.createSourceFile('backups.ts',fs.readFileSync(path.join(core,'lib/tools/backups.ts'),'utf8'),ts.ScriptTarget.Latest,true),required=new Set();
 for(const statement of source.statements)if((ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))&&statement.moduleSpecifier?.text.endsWith('-restore.mjs')&&!statement.importClause?.isTypeOnly)required.add(statement.moduleSpecifier.text);
 const requiredSourceResolutions=[...required].map(specifier=>{try{return{specifier,resolved:owner.resolve(specifier)};}catch(error){return{specifier,code:error.code};}});
 return{exists:true,path:'packages/ingenium-core/dist/lib/tools/backups.js',bytes:raw.length,sha256:sha(raw),observedRestoreImports,requiredSourceResolutions,note:'Read-only existing output; not current or rebuilt. Source-required specifiers resolved from this original output location without module execution.'};
})();
function virtualDistribution(){
 const tree=new Map(),writes=[];const within=p=>typeof p==='string'&&(p===destination||p.startsWith(destination+path.sep));
 const stat=row=>({size:row.bytes?.length??0,nlink:1,uid:0,gid:0,mode:row.mode??0o444,dev:1,ino:1,mtimeMs:0,ctimeMs:0,isFile:()=>row.type==='file',isDirectory:()=>row.type==='directory',isSymbolicLink:()=>row.type==='symlink'});
 const missing=()=>{throw Object.assign(Error('Virtual distribution entry missing'),{code:'ENOENT'});};
 const io={...fs,
  existsSync(p){return within(p)?tree.has(p)&&tree.get(p).type!=='symlink':fs.existsSync(p);},
  realpathSync(p){return within(p)?(tree.has(p)?p:missing()):fs.realpathSync(p);},
  lstatSync(p){return within(p)?(tree.has(p)?stat(tree.get(p)):missing()):fs.lstatSync(p);},
  readFileSync(p,encoding){if(!within(p))return fs.readFileSync(p,encoding);const row=tree.get(p);if(!row||row.type!=='file')missing();return encoding?row.bytes.toString(encoding):Buffer.from(row.bytes);},
  mkdirSync(p){assert.ok(within(p),'No path outside original Core output');const parents=[];for(let current=p;within(current);current=path.dirname(current))parents.push(current);for(const current of parents.reverse())if(!tree.has(current))tree.set(current,{type:'directory',mode:0o755});},
  writeFileSync(p,bytes,options){assert.ok(within(p),'No write outside virtual Core distribution');assert.equal(options.flag,'wx');if(tree.has(p))throw Error('Exclusive output already exists');tree.set(p,{type:'file',bytes:Buffer.from(bytes),mode:options.mode});writes.push(p);},
  chmodSync(p,mode){assert.ok(within(p));tree.get(p).mode=mode;},
 };
 return{io,tree,writes};
}
test('Core original compiler omits MJS while exact existing build gains one same-owner copy hook',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(core,'tsconfig.json'),'utf8'));assert.deepEqual(config.include,['lib/**/*.ts','data/**/*']);assert.equal(config.compilerOptions.outDir,'./dist');
 const old=JSON.parse(proposal.edits.find(e=>e.path==='packages/ingenium-core/package.json').before),next=JSON.parse(post('packages/ingenium-core/package.json'));
 assert.equal(next.scripts.build,'rm -rf dist && tsc && node scripts/copy-core-runtime.mjs && cp -r data dist/data');
 next.scripts.build=old.scripts.build;assert.deepEqual(next,old);assert.equal(proposal.edits.filter(e=>e.path.includes('package-lock')).length,0);
});
test('exact actual four helper/declaration bytes and hashes are planned next to original backups output',()=>{
 assert.deepEqual(Array.from(copier.CORE_RUNTIME_FILES),CORE_HELPERS);assert.equal(plan.files.length,4);assert.equal(plan.destination,destination);
 for(const row of plan.files){const actual=fs.readFileSync(path.join(core,row.source));assert.ok(actual.equals(row.raw));assert.equal(row.sourceSha256,sha(actual));assert.equal(row.artifactSha256,sha(actual));assert.equal(row.target,path.join(destination,row.source));}
 assert.equal(sha(fs.readFileSync(path.join(core,'lib/tools/voice-attachment-restore.mjs'))),'7a4452808bde5b20e3261a9d47e59b2c3d520eae1f6d11e0efd49df48c8352d3');
 assert.doesNotMatch(copierSource,/readdirSync|copyFile|cpSync|glob|execFile|spawn\(|transpile|createProgram/);
});
test('actual helper runtime closure is Node crypto only; declarations use existing database types',()=>{
 for(const row of plan.files){if(row.source.endsWith('.mjs'))assert.deepEqual(Array.from(row.imports,r=>r.specifier),['node:crypto']);else assert.deepEqual(Array.from(row.imports,r=>({specifier:r.specifier,typeOnly:r.typeOnly})),[{specifier:'better-sqlite3',typeOnly:true}]);}
 assert.throws(()=>copier.validateCoreRuntimeImports(CORE_HELPERS[0],'import x from "unreviewed-package";'),/undeclared dependency/);
 assert.throws(()=>copier.validateCoreRuntimeImports(CORE_HELPERS[0],'import x from "./another.mjs";'),/outside fixed helpers/);
 assert.throws(()=>copier.validateCoreRuntimeImports(CORE_HELPERS[0],'await import("node:crypto");'),/runtime import/);
 assert.throws(()=>copier.validateCoreRuntimeImports(CORE_HELPERS[0],'const x=require("node:crypto");'),/runtime import/);
});
test('actual backups TS runtime imports/reexports resolve to the same fixed byte-copy targets',()=>{
 const source=fs.readFileSync(path.join(core,'lib/tools/backups.ts'),'utf8'),tree=ts.createSourceFile('backups.ts',source,ts.ScriptTarget.Latest,true),seen=new Set();
 for(const stmt of tree.statements){if(!(ts.isImportDeclaration(stmt)||ts.isExportDeclaration(stmt))||!stmt.moduleSpecifier||!stmt.moduleSpecifier.text.endsWith('-restore.mjs'))continue;
  const specifier=stmt.moduleSpecifier.text,target=path.resolve(path.dirname(actualOutput),specifier),row=plan.files.find(e=>e.target===target);assert.ok(row,specifier);seen.add(specifier);
  const helper=ts.createSourceFile(row.source,row.raw.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),exported=new Set();
  for(const n of helper.statements)if(n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){if(ts.isFunctionDeclaration(n)&&n.name)exported.add(n.name.text);if(ts.isVariableStatement(n))for(const declaration of n.declarationList.declarations)if(ts.isIdentifier(declaration.name))exported.add(declaration.name.text);}
  const clause=ts.isImportDeclaration(stmt)?stmt.importClause?.namedBindings:stmt.exportClause;if(clause&&ts.isNamedImports(clause)||clause&&ts.isNamedExports(clause))for(const binding of clause.elements)if(!binding.isTypeOnly)assert.ok(exported.has((binding.propertyName??binding.name).text),specifier+' export '+binding.name.text);
 }
 assert.deepEqual([...seen].sort(),['./learned-memory-restore.mjs','./voice-attachment-restore.mjs']);
});
test('read-only actual old-output witness records resolver outcome without executing Core/helper',()=>{
 if(originalOutputWitness.exists){assert.ok(originalOutputWitness.sha256);assert.equal(originalOutputWitness.requiredSourceResolutions.length,2);for(const row of originalOutputWitness.requiredSourceResolutions)assert.ok(row.resolved||row.code==='MODULE_NOT_FOUND');}
 assert.ok(!proposal.edits.some(e=>e.path.includes('/dist/')));
});
test('same materializer produces exactly four immutable byte copies and one hash manifest in memory only',async()=>{
 const virtual=virtualDistribution(),owner=await load(virtual.io),manifest=owner.materializeCoreRuntime(owner.planCoreRuntime({coreRoot:core}));
 assert.equal(virtual.writes.length,5);for(const row of plan.files){const out=virtual.tree.get(row.target);assert.ok(out.bytes.equals(row.raw));assert.equal(out.mode,0o444);}
 const manifestPath=path.join(destination,'veyra-core-runtime-closure.json');assert.deepEqual(JSON.parse(virtual.tree.get(manifestPath).bytes),JSON.parse(JSON.stringify(manifest)));
 owner.materializeCoreRuntime(owner.planCoreRuntime({coreRoot:core}));assert.equal(virtual.writes.length,5);
});
test('source mismatch and unsafe/different existing targets refuse without deleting or overwriting evidence',async()=>{
 const virtual=virtualDistribution(),owner=await load(virtual.io),p=owner.planCoreRuntime({coreRoot:core});
 const bad={...p,manifest:{...p.manifest,kind:'substituted'}};assert.throws(()=>owner.materializeCoreRuntime(bad),/source changed/);assert.equal(virtual.writes.length,0);
 virtual.tree.set(destination,{type:'directory'});virtual.tree.set(p.files[0].target,{type:'symlink'});assert.throws(()=>owner.materializeCoreRuntime(p),/alias\/type/);assert.equal(virtual.writes.length,0);
 virtual.tree.set(p.files[0].target,{type:'file',bytes:Buffer.from('original failure evidence')});assert.throws(()=>owner.materializeCoreRuntime(p),/existing output differs/);assert.equal(virtual.writes.length,0);assert.equal(virtual.tree.get(p.files[0].target).bytes.toString(),'original failure evidence');
});
test('missing exact helper refuses before output and caller-provided target/bytes cannot widen writes',async()=>{
 const virtual=virtualDistribution(),denied=path.join(core,CORE_HELPERS[2]);const io={...virtual.io,realpathSync(p){if(p===denied)throw Object.assign(Error('Missing canonical helper'),{code:'ENOENT'});return virtual.io.realpathSync(p);}};
 const missing=await load(io);assert.throws(()=>missing.planCoreRuntime({coreRoot:core}),/Missing canonical helper/);assert.equal(virtual.writes.length,0);
 const owner=await load(virtual.io),p=owner.planCoreRuntime({coreRoot:core});owner.materializeCoreRuntime({...p,destination:'/caller-selected',files:[{target:'/caller-selected/overwrite',raw:Buffer.from('bad')}]});assert.equal(virtual.writes.length,5);assert.ok(virtual.writes.every(p=>p.startsWith(destination+path.sep)));
});
test('candidate rows add actual Core132 consumer path/helpers without reusing previous103 hashes',()=>{
 const next=parseContract(post('packages/veyra-operations/core126-image-contract.mjs'));for(const p of proposal.sourceAdditions)assert.ok(next.source.includes(p));for(const p of proposal.imageAdditions)assert.ok(next.image.includes(p));
 assert.ok(next.source.includes('packages/ingenium-core/data/migrations/132_voice_attachment_deliveries.sql'));
 assert.ok(next.image.includes('/app/packages/ingenium-core/dist/data/migrations/132_voice_attachment_deliveries.sql'));
 assert.ok(next.image.includes('/app/packages/ingenium-core/dist/veyra-core-runtime-closure.json'));
 assert.equal(new Set(next.source).size,next.source.length);assert.equal(new Set(next.image).size,next.image.length);
 assert.ok(fs.readFileSync(path.join(core,'lib/db.ts'),'utf8').includes('resolve(import.meta.dirname ?? __dirname, "../data/migrations")'));
});
test('Docker reuses original Core dist COPY and checks exact seven artifacts, no extra tree or compiler include',()=>{
 const docker=post('Dockerfile');assert.equal((docker.match(/COPY --from=builder --chown=root:root \/app\/packages\/ingenium-core\/dist /g)??[]).length,1);
 for(const name of proposal.imageAdditions)assert.ok(docker.includes(JSON.stringify(name)));assert.doesNotMatch(docker,/code-server|vscode|open-vsx/);
 assert.ok(!proposal.edits.some(e=>e.path.endsWith('tsconfig.json')));
 const marker=docker.indexOf('# Verify the same Core build-owned'),line=docker.slice(marker).split('\n').find(l=>l.startsWith('RUN node -e '));
 if(process.platform==='win32')execFileSync('wsl',['-d','Ubuntu','-u','brajam','--','sh','-n'],{input:line.slice(4)+'\n'});else execFileSync('sh',['-n'],{input:line.slice(4)+'\n'});
});
test('actual helper JS and build tool parse; no source input or original generated output changes',()=>{
 for(const row of plan.files.filter(r=>r.source.endsWith('.mjs')))new vm.SourceTextModule(row.raw.toString());new vm.SourceTextModule(copierSource);
 for(const edit of proposal.edits)if(edit.before.length)assert.ok(fs.readFileSync(path.join(root,edit.path)).equals(edit.before));else assert.equal(fs.existsSync(path.join(root,edit.path)),false);
 if(originalOutputWitness.exists)assert.equal(sha(fs.readFileSync(actualOutput)),originalOutputWitness.sha256);
});
