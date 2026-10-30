import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";import {fileURLToPath} from "node:url";
import {source,names,transformed} from "./portable-compat.mjs";
const directory=path.dirname(fileURLToPath(import.meta.url)),checkout=path.resolve(directory,"../../../..");
const phase=path.resolve(checkout,"../.."),native=path.join(phase,"windows-source");
const ts=createRequire(import.meta.url)(path.resolve(phase,"../prd-ui-fixes/node_modules/typescript/lib/typescript.js"));
const overrides=new Map(names.map(name=>[path.join(source,name),transformed(name)]));
const web=path.join(directory,"files/apps/web/src/platform/hostedGovernance.ts");
const all=fs.readdirSync(source).filter(name=>/\.(tsx?|mts)$/.test(name)&&!name.endsWith(".test.tsx")).map(name=>path.join(source,name));
const options={noEmit:true,strict:true,noUnusedLocals:true,noUnusedParameters:true,allowImportingTsExtensions:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.ReactJSX,skipLibCheck:true,types:[]};
const host=ts.createCompilerHost(options),get=host.getSourceFile.bind(host);let emitted=0;
host.getSourceFile=(file,languageVersion,...rest)=>overrides.has(file)?ts.createSourceFile(file,overrides.get(file),languageVersion,true):get(file,languageVersion,...rest);
host.readFile=(file)=>overrides.get(file)??ts.sys.readFile(file);
host.writeFile=()=>{emitted++;throw new Error("No source-check emission permitted");};
host.resolveModuleNames=(modules,from)=>modules.map(name=>{
 if(from===web&&name==="./types")return {resolvedFileName:path.join(native,"apps/web/src/platform/types.ts"),extension:ts.Extension.Ts};
 if(from===web&&name.endsWith("/hosted-governance/contracts"))return {resolvedFileName:path.join(source,"contracts.ts"),extension:ts.Extension.Ts};
 return ts.resolveModuleName(name,from,options,host).resolvedModule??(!name.startsWith(".")?ts.resolveModuleName(name,path.join(native,"apps/web/__source_check__.tsx"),options,host).resolvedModule:undefined);
});
const program=ts.createProgram([...all,web],options,host),diagnostics=ts.getPreEmitDiagnostics(program);
for(const d of diagnostics){const where=d.file&&d.start!==undefined?d.file.fileName+":"+(d.file.getLineAndCharacterOfPosition(d.start).line+1)+": ":"";process.stderr.write(where+ts.flattenDiagnosticMessageText(d.messageText,"\n")+"\n");}
console.log(JSON.stringify({portableAndWebFiles:all.length+1,compatibilityOverrides:overrides.size,diagnostics:diagnostics.length,emitted}));
if(diagnostics.length)process.exitCode=1;
