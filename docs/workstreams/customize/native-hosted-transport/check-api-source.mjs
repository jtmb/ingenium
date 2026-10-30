import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";import {fileURLToPath} from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url)),checkout=path.resolve(root,"../../../.."),phase=path.resolve(checkout,"../.."),app=path.resolve(phase,"../prd-ui-fixes");
const ts=createRequire(import.meta.url)(path.join(app,"node_modules/typescript/lib/typescript.js"));
const base=path.join(root,"files/services/ingenium-api/lib"),engine=path.join(phase,"parallel/rust-api/docs/workstreams/rust-api/hosted-governance/proposed/hosted-governance.ts");
const core=path.join(base,"__frozen_core__.d.ts"),context=path.join(base,"routes/__frozen_context__.d.ts");
const virtual=new Map([
 [core,'export * from "'+engine+'";\nexport declare function getDb():import("'+engine+'").SqlDb;\ndeclare global{namespace Express{interface Request{principal?:{type:"user";id:string;session?:unknown}|{type:"service"|"compatibility"|"runtime-service";id:string};}}}\n'],
 [context,'import type {Request} from "express";import type {Row,VerifiedNative} from "ingenium-core";export interface VerifiedNativeContextOwner{enrollment(request:Request,requestId:string,actorId:string):VerifiedNative;current(request:Request,grant:Row,recovery:boolean,actorId:string):void;}\n']
]);
const options={noEmit:true,strict:true,noUnusedLocals:true,noUnusedParameters:true,skipLibCheck:true,allowImportingTsExtensions:true,esModuleInterop:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,types:["node"],typeRoots:[path.join(app,"node_modules/@types")]};
const host=ts.createCompilerHost(options),get=host.getSourceFile.bind(host);let emitted=0;
host.fileExists=file=>virtual.has(file)||ts.sys.fileExists(file);host.readFile=file=>virtual.get(file)??ts.sys.readFile(file);
host.getSourceFile=(file,language,...rest)=>virtual.has(file)?ts.createSourceFile(file,virtual.get(file),language,true):get(file,language,...rest);
host.resolveModuleNames=(names,from)=>names.map(name=>{
 if(name==="ingenium-core")return {resolvedFileName:core,extension:ts.Extension.Dts};
 if(name==="./routes/native-customize-context.js")return {resolvedFileName:context,extension:ts.Extension.Dts};
 return ts.resolveModuleName(name,from,options,host).resolvedModule??ts.resolveModuleName(name,path.join(app,"services/ingenium-api/__source_check__.ts"),options,host).resolvedModule;
});
host.writeFile=()=>{emitted++;throw new Error("No source check emission");};
const files=fs.readdirSync(base).filter(n=>n.endsWith(".ts")).map(n=>path.join(base,n));
const program=ts.createProgram([...files,core,context],options,host),diagnostics=ts.getPreEmitDiagnostics(program);
for(const d of diagnostics){const where=d.file&&d.start!==undefined?d.file.fileName+":"+(d.file.getLineAndCharacterOfPosition(d.start).line+1)+": ":"";process.stderr.write(where+ts.flattenDiagnosticMessageText(d.messageText,"\n")+"\n");}
console.log(JSON.stringify({privateNodeSourceFiles:files.length,contract:"Actual frozen Worker5 engine plus exact source-context interface, no runtime auth stub",diagnostics:diagnostics.length,emitted}));
if(diagnostics.length)process.exitCode=1;
