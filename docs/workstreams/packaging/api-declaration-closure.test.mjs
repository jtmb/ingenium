import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import vm from'node:vm';import test from'node:test';import * as crypto from'node:crypto';import * as urls from'node:url';import{createRequire}from'node:module';
import{proposeApiDeclarations}from'./api-declaration-closure-proposal.mjs';import{reviewedDeclarationInputs}from'./api-declaration-closure-inventory.mjs';
const root=process.env.VEYRA_DECLARATION_ROOT;if(!root)throw Error('Actual Root source required');
export const edits=proposeApiDeclarations(root),code=edits[0].after.toString(),destination=path.join(root,'services/ingenium-api/dist'),ts=createRequire(path.join(root,'package.json'))('typescript'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function load(source=code,io=fs){const context=vm.createContext({Buffer,process:{argv:[],env:{}},console});const module=new vm.SourceTextModule(source,{context,identifier:urls.pathToFileURL(path.join(root,edits[0].path)).href,initializeImportMeta(meta,m){meta.url=m.identifier;}});const deps=new Map([['node:fs',io],['node:path',path],['node:url',urls],['node:crypto',crypto],['typescript',ts]]);await module.link(name=>{const obj=deps.get(name);if(!obj)throw Error('Unexpected copier dependency');const keys=[...new Set(['default',...Object.keys(obj)])];return new vm.SyntheticModule(keys,function(){for(const key of keys)this.setExport(key,key==='default'?obj:obj[key]);},{context});});await module.evaluate();return module.namespace;}
export const owner=await load(),plan=owner.planDomainRuntime({sourceRoot:root,destination});
const originalOwner=await load(edits[0].before.toString()),original=originalOwner.planDomainRuntime({sourceRoot:root,destination});
const expectedFiles=original.entries.length+reviewedDeclarationInputs.length+original.compiledRelocations.length*2+plan.declarations.compilerInputs.length;
function virtualDistribution(){const tree=new Map(),fds=new Map(),writes=[],uid=fs.statSync(root).uid;let fd=-100,ino=100;
 const inside=p=>typeof p==='string'&&(p===destination||p.startsWith(destination+path.sep));
 const missing=()=>{throw Object.assign(Error('Virtual compiler output missing'),{code:'ENOENT'});};
 const stat=row=>({uid,gid:uid,nlink:row.nlink??1,dev:1,ino:row.ino,size:row.bytes?.length??0,mtimeMs:0,ctimeMs:0,mode:row.mode??0o644,isFile:()=>row.kind==='file',isDirectory:()=>row.kind==='directory',isSymbolicLink:()=>row.kind==='symlink'});
 function seed(p,text){for(let q=path.dirname(p);inside(q);q=path.dirname(q))if(!tree.has(q))tree.set(q,{kind:'directory',ino:ino++});tree.set(p,{kind:'file',bytes:Buffer.from(text),ino:ino++});}
 const io={...fs,existsSync(p){return inside(p)?tree.has(p)&&tree.get(p).kind!=='symlink':fs.existsSync(p);},lstatSync(p){return inside(p)?(tree.has(p)?stat(tree.get(p)):missing()):fs.lstatSync(p);},realpathSync(p){return inside(p)?(tree.has(p)?p:missing()):fs.realpathSync(p);},openSync(p,flags,mode){if(!inside(p))return fs.openSync(p,flags,mode);if(!tree.has(p)){if(!(flags&fs.constants.O_CREAT))missing();seed(p,'');}else if(flags&fs.constants.O_EXCL)throw Error('Exclusive virtual output exists');const id=fd--;fds.set(id,p);return id;},fstatSync(id){return fds.has(id)?stat(tree.get(fds.get(id))):fs.fstatSync(id);},readFileSync(p,encoding){if(fds.has(p))p=fds.get(p);if(!inside(p))return fs.readFileSync(p,encoding);const row=tree.get(p);if(!row||row.kind!=='file')missing();return encoding?row.bytes.toString(encoding):Buffer.from(row.bytes);},closeSync(id){if(fds.has(id))fds.delete(id);else fs.closeSync(id);},mkdirSync(p){assert.ok(inside(p));for(let q=p;inside(q);q=path.dirname(q))if(!tree.has(q))tree.set(q,{kind:'directory',ino:ino++});},ftruncateSync(id,size){assert.equal(size,0);tree.get(fds.get(id)).bytes=Buffer.alloc(0);},writeSync(id,bytes,offset,length,position){const p=fds.get(id);assert.ok(inside(p));const row=tree.get(p),next=Buffer.alloc(Math.max(row.bytes.length,position+length));row.bytes.copy(next);bytes.copy(next,position,offset,offset+length);row.bytes=next;writes.push(p);return length;},fchmodSync(id,mode){tree.get(fds.get(id)).mode=mode;}};
 // Explicit synthetic compiler output, not tsc and not actual build acceptance.
 for(const row of plan.compiledRelocations){const runtime=row.references.filter(r=>r.runtimeRequired).map((r,i)=>'import * as R'+i+' from '+JSON.stringify(r.source)+';').join('\n')||'export {};';seed(row.target,runtime);seed(row.declarationTarget,row.references.map((r,i)=>'import type {T'+i+'} from '+JSON.stringify(r.source)+';').join('\n')||'export {};');}
 for(const row of plan.declarations.compilerInputs)seed(row.target,'import type {DotScope} from "../../../../packages/veyra-automation/contracts.js";\nexport type Scope = DotScope;');
 for(const row of plan.declarations.context.compilerTypes.values())if(!tree.has(row.target))seed(row.target,'export {};');
 return{io,tree,writes,seed};
}
test('68 declarations each have a concrete output or type consumer; unreachable declaration omitted',()=>{
 assert.equal(reviewedDeclarationInputs.length,68);assert.equal(reviewedDeclarationInputs.filter(r=>r.runtimeSource).length,65);assert.ok(!reviewedDeclarationInputs.some(r=>r.source.endsWith('/selected-state-admission.d.mts')));
 assert.equal(plan.entries.length,original.entries.length+68);assert.equal(plan.compiledRelocations.length,6);assert.equal(plan.declarations.compilerInputs.length,10);
 for(const row of original.entries){const next=plan.entries.find(e=>e.source===row.source);assert.equal(next.target,row.target);assert.equal(next.sourceSha256,row.sourceSha256);assert.equal(next.emittedSha256,row.emittedSha256);}
 assert.equal(JSON.stringify(plan.compiledRelocations),JSON.stringify(original.compiledRelocations));
});
test('raw declarations resolve through the same runtime/type map, including both actual shared contracts',()=>{
 const raw=plan.entries.find(r=>r.source.endsWith('managed-job-contracts.d.mts'));assert.ok(raw.emitted.includes('../../veyra-packages/veyra-operations/core126-image-owner.mjs'));assert.ok(raw.emitted.includes('../../veyra-packages/veyra-automation/contracts.js'));assert.ok(raw.emitted.includes('./core-binding.js'));
 assert.ok(!plan.entries.some(r=>r.target.endsWith('managed-job-contracts.mjs')));
 for(const name of ['veyra-projects','veyra-automation'])assert.ok(plan.entries.some(r=>r.target===path.join(destination,'veyra-packages',name,'contracts.d.ts')));
});
test('required transitive declaration omission, duplicate map and wrong runtime depth refuse',async()=>{
 const list=JSON.stringify(reviewedDeclarationInputs),required='services/ingenium-api/lib/dot-v2/managed-job-contracts.d.mts';
 const missing=await load(code.replace(list,JSON.stringify(reviewedDeclarationInputs.filter(r=>r.source!==required))));assert.throws(()=>missing.planDomainRuntime({sourceRoot:root,destination}),/Missing transitive/);
 const duplicate=await load(code.replace(list,JSON.stringify([...reviewedDeclarationInputs,reviewedDeclarationInputs[0]])));assert.throws(()=>duplicate.planDomainRuntime({sourceRoot:root,destination}),/Duplicate/);
 const wrong=await load(code.replace(list,JSON.stringify(reviewedDeclarationInputs.map((r,i)=>i===0?{...r,target:'wrong-depth/contracts.d.ts'}:r))));assert.throws(()=>wrong.planDomainRuntime({sourceRoot:root,destination}),/type-only module|target changed|runtime target/);
});
test('incorrect unknown declaration references refuse rather than fallback',()=>{
 const row=plan.entries.find(r=>r.source.endsWith('managed-job-contracts.d.mts'));assert.throws(()=>owner.rewriteReviewedDeclaration('import type {X} from "../../../../unknown/missing.mjs";',row,plan.declarations.context),/Missing transitive/);
 assert.throws(()=>owner.rewriteReviewedDeclaration('import type {X} from "unreviewed-package";',row,plan.declarations.context),/Undeclared declaration package/);
});
test('all compiler/raw postimages and manifest hashes plan before any write; duplicate legitimate type imports preserved',async()=>{
 const v=virtualDistribution(),tool=await load(code,v.io),p=tool.planDomainRuntime({sourceRoot:root,destination}),prepared=tool.prepareDomainRuntimePostimages(p);
 assert.equal(v.writes.length,0);assert.equal(prepared.files.length,expectedFiles);assert.equal(new Set(prepared.files.map(r=>r.target)).size,expectedFiles);
 for(const row of prepared.files){assert.equal(row.emittedSha256,sha(row.emitted));const receipt=prepared.manifest.files.find(r=>r.path===path.relative(destination,row.target).split(path.sep).join('/'));assert.equal(receipt.sourceSha256,row.sourceSha256);assert.equal(receipt.emittedSha256,row.emittedSha256);}
 const source=p.declarations.compilerInputs.find(r=>r.source.endsWith('commands.ts')),text='import type {A} from "../../../../packages/veyra-automation/contracts.js";\nimport type {B} from "../../../../packages/veyra-automation/contracts.js";';
 assert.equal((tool.rewriteReviewedDeclaration(text,source,p.declarations.context).match(/veyra-packages\/veyra-automation\/contracts.js/g)??[]).length,2);
});
test('missing compiled transitive input and unsafe output refuse before any content write',async()=>{
 const v=virtualDistribution(),tool=await load(code,v.io),p=tool.planDomainRuntime({sourceRoot:root,destination});v.tree.delete(p.declarations.compilerInputs.at(-1).target);assert.throws(()=>tool.materializeDomainRuntime(p),/missing/);assert.equal(v.writes.length,0);
 const w=virtualDistribution(),writer=await load(code,w.io),q=writer.planDomainRuntime({sourceRoot:root,destination});w.seed(q.entries.at(-1).target,'protected');w.tree.get(q.entries.at(-1).target).nlink=2;assert.throws(()=>writer.materializeDomainRuntime(q),/Unsafe packaging/);assert.equal(w.writes.length,0);
});
test('same materializer writes only the complete virtual distribution with one manifest and no runtime type stubs',async()=>{
 const v=virtualDistribution(),tool=await load(code,v.io),p=tool.planDomainRuntime({sourceRoot:root,destination}),manifest=tool.materializeDomainRuntime(p);assert.equal(manifest.files.length,expectedFiles);
 assert.equal(new Set(v.writes).size,expectedFiles+1);for(const row of manifest.files){const file=path.join(destination,...row.path.split('/'));assert.equal(sha(v.tree.get(file).bytes),row.emittedSha256);}
 assert.ok(!v.tree.has(path.join(destination,'lib/dot-v2/managed-job-contracts.mjs')));assert.ok(!v.tree.has(path.join(destination,'veyra-packages/veyra-projects/contracts.js')));
});
test('changed planned source hashes refuse before writes and actual source remains untouched',async()=>{
 const v=virtualDistribution(),tool=await load(code,v.io),p=tool.planDomainRuntime({sourceRoot:root,destination}),bad={...p,entries:p.entries.map((r,i)=>i===0?{...r,sourceSha256:'0'.repeat(64)}:r)};assert.throws(()=>tool.materializeDomainRuntime(bad),/plan\/source changed/);assert.equal(v.writes.length,0);assert.ok(fs.readFileSync(path.join(root,edits[0].path)).equals(edits[0].before));
});

test('single-link and stable-stat source guards reject actual-input metadata faults before outputs',async()=>{
 const target=path.join(root,...reviewedDeclarationInputs[0].source.split('/'));
 for(const fault of ['hardlink','changed']){
  const v=virtualDistribution(),tracked=new Map(),counts=new Map(),io={...v.io,openSync(p,flags,mode){const fd=v.io.openSync(p,flags,mode);if(p===target)tracked.set(fd,p);return fd;},fstatSync(fd){const stat=v.io.fstatSync(fd);if(!tracked.has(fd))return stat;const n=(counts.get(fd)??0)+1;counts.set(fd,n);const value=Object.create(stat);Object.defineProperty(value,fault==='hardlink'?'nlink':'mtimeMs',{value:fault==='hardlink'?2:stat.mtimeMs+(n>1?1:0)});return value;},closeSync(fd){tracked.delete(fd);v.io.closeSync(fd);}};
  const tool=await load(code,io);assert.throws(()=>tool.planDomainRuntime({sourceRoot:root,destination}),fault==='hardlink'?/Unsafe packaging input/:/input changed/);assert.equal(v.writes.length,0);
 }
});