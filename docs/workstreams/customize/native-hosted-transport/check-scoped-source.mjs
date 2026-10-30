import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),app=process.argv[2]??'/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes';
const ts=createRequire(import.meta.url)(app+'/node_modules/typescript/lib/typescript.js');
const manifest=JSON.parse(fs.readFileSync(here+'/scoped-source-manifest.json','utf8')),virtual=new Map();
for(const row of manifest.sources.filter(r=>r.path.endsWith('.ts')))virtual.set(app+'/'+row.path,fs.readFileSync(here+'/files/'+row.path,'utf8'));
const options={noEmit:true,strict:true,skipLibCheck:true,esModuleInterop:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,types:['node'],typeRoots:[app+'/node_modules/@types'],resolveJsonModule:true};
const host=ts.createCompilerHost(options),get=host.getSourceFile.bind(host),exists=host.fileExists.bind(host),read=host.readFile.bind(host);let emitted=0;
host.fileExists=p=>virtual.has(p)||exists(p);host.readFile=p=>virtual.get(p)??read(p);host.getSourceFile=(p,v,...rest)=>virtual.has(p)?ts.createSourceFile(p,virtual.get(p),v,true):get(p,v,...rest);
host.resolveModuleNames=(names,from)=>names.map(n=>{
 if(n==='ingenium-core')return {resolvedFileName:app+'/packages/ingenium-core/lib/index.ts',extension:ts.Extension.Ts};
 if(n.startsWith('ingenium-core/lib/'))return {resolvedFileName:app+'/packages/ingenium-core/lib/'+n.slice('ingenium-core/lib/'.length)+'.ts',extension:ts.Extension.Ts};
 return ts.resolveModuleName(n,from,options,host).resolvedModule;
});host.writeFile=()=>{emitted++;throw Error('Source-only check attempted an output');};
const roots=[...virtual.keys()],program=ts.createProgram(roots,options,host),diagnostics=ts.getPreEmitDiagnostics(program);
console.log(JSON.stringify({strictRootFiles:roots.length,actualSourceFiles:program.getSourceFiles().length,diagnostics:diagnostics.length,emitted}));
for(const d of diagnostics.slice(0,24)){const pos=d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start):undefined;console.log((d.file?.fileName??'')+':'+(pos?pos.line+1:0)+': '+ts.flattenDiagnosticMessageText(d.messageText,' '));}
if(diagnostics.length||emitted)process.exitCode=1;