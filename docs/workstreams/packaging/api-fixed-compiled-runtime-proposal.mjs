import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
export const API_COPIER='services/ingenium-api/scripts/copy-domain-runtime.mjs';
export const API_PREIMAGE_SHA256='b360aa94aeea2ad0b743ba1d7bee7b7369ab4867131a881c0f2781d33836c3e5';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function proposeApiFixedCompiledRuntime(root){
 const before=fs.readFileSync(path.join(root,API_COPIER));if(hash(before)!==API_PREIMAGE_SHA256)throw Error('Actual API copier preimage drift; review required');
 const crlf=before.includes(Buffer.from('\r\n'));let text=before.toString().replaceAll('\r\n','\n');const once=(a,b)=>{if(!text.includes(a)||text.indexOf(a)!==text.lastIndexOf(a))throw Error('Fixed compiler patch anchor drift: '+a.slice(0,80));text=text.replace(a,b)};
 once('export function prepareDomainRuntimePostimages(plan){',fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'api-fixed-compiled-runtime-fragment.mjs'),'utf8')+'\nexport function prepareDomainRuntimePostimages(plan){');
 once('sourceSha256:row.sourceSha256,emittedSha256:digest(emitted),emitted,kind:runtime?', 'sourceSha256:row.sourceSha256,originalCompilerSha256:digest(Buffer.from(before)),emittedSha256:digest(emitted),emitted,kind:runtime?');
 once('compiled:p.compiledRelocations,declarationCompiler:', 'compiled:p.compiledRelocations,fixed:p.fixedCompiledRuntime,declarationCompiler:');
 once('for(const row of current.declarations.compilerInputs){const before=', 'const fixedCompilerReadback=prepareFixedCompiledRuntimeDependencies(current,compiled);\n for(const row of current.declarations.compilerInputs){if(compiled.some(r=>r.target===row.target))continue;const before=');
 once('const manifest={schemaVersion:1,files:', 'const manifest={schemaVersion:1,fixedCompilerReadback,fixedCompilerConfig:{configSha256:current.fixedCompiledRuntime.configSha256,baseConfigSha256:current.fixedCompiledRuntime.baseConfigSha256},files:');
 once('  const planned = [];\n  for (const entry of files.values()) {', '  const fixedCompiledRuntime=planFixedCompiledRuntimeDependencies({sourceRoot,destination,runtimeEntries:[...files.values()]});\n  const directCompiled=new Map(fixedCompiledRuntime.files.filter(r=>fixedCompiledRuntime.directSources.includes(path.relative(sourceRoot,r.source).split(path.sep).join(\'/\'))).map(r=>[r.source.slice(0,-3)+\'.js\',r]));\n  const planned = [];\n  for (const entry of files.values()) {');
 once('const dependency = files.get(source);\n      if (!dependency)', 'const dependency = files.get(source) ?? directCompiled.get(source);\n      if (!dependency)');
 once('entries: [...planned,...declarations.entries], compiledRelocations, declarations','entries: [...planned,...declarations.entries], compiledRelocations, fixedCompiledRuntime, declarations');
 const after=Buffer.from(crlf?text.replaceAll('\n','\r\n'):text);return{path:API_COPIER,before,after,preimageSha256:hash(before),postimageSha256:hash(after)};
}