import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const args=process.argv.slice(2),i=args.indexOf("--typescript");
if(i<0||!args[i+1])throw new Error("Provide read-only existing TypeScript library using --typescript");
const ts=require(args[i+1]),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../../packages/veyra-customize/hosted-governance");
const files=fs.readdirSync(root).filter(file=>/\.(ts|tsx|mts)$/.test(file)).map(file=>path.join(root,file));
const syntax=files.flatMap(file=>ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics);
const pure=["client.ts","contracts.ts","decoders.ts","writeOutcome.ts","verification.ts"].map(file=>path.join(root,file));
const options={noEmit:true,strict:true,noUnusedLocals:true,noUnusedParameters:true,allowImportingTsExtensions:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  skipLibCheck:true,types:[]};
let emitted=0;
const host=ts.createCompilerHost(options);
host.writeFile=()=>{emitted++;throw new Error("Source check must not emit");};
const program=ts.createProgram(pure,options,host);
const diagnostics=[...syntax,...ts.getPreEmitDiagnostics(program)];
for(const d of diagnostics)process.stderr.write(ts.flattenDiagnosticMessageText(d.messageText,"\n")+"\n");
if(diagnostics.length)process.exitCode=1;
console.log(JSON.stringify({syntaxFiles:files.length,pureFiles:pure.length,diagnostics:diagnostics.length,emitted}));
const peerIndex=args.indexOf("--native-peers");
if(peerIndex>=0){
  const peers=args[peerIndex+1];if(!peers)throw new Error("Missing native peer directory");
  const fullOptions={...options,jsx:ts.JsxEmit.ReactJSX};
  const fullHost=ts.createCompilerHost(fullOptions);
  fullHost.writeFile=host.writeFile;
  fullHost.resolveModuleNames=(names,containingFile)=>names.map(name=>{
    const normal=ts.resolveModuleName(name,containingFile,fullOptions,fullHost).resolvedModule;
    return normal??(!name.startsWith(".")?ts.resolveModuleName(name,path.join(peers,"__source_check__.tsx"),fullOptions,fullHost).resolvedModule:undefined);
  });
  const fullFiles=files.filter(file=>!file.endsWith(".test.tsx"));
  const fullProgram=ts.createProgram(fullFiles,fullOptions,fullHost),fullDiagnostics=ts.getPreEmitDiagnostics(fullProgram);
  for(const d of fullDiagnostics){
    const where=d.file&&d.start!==undefined?d.file.fileName+":"+ (d.file.getLineAndCharacterOfPosition(d.start).line+1)+": ":"";
    process.stderr.write(where+ts.flattenDiagnosticMessageText(d.messageText,"\n")+"\n");
  }
  if(fullDiagnostics.length)process.exitCode=1;
  console.log(JSON.stringify({nativePeerSourceFiles:fullFiles.length,diagnostics:fullDiagnostics.length,emitted}));
}
