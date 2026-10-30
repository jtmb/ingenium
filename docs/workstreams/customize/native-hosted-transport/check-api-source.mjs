import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";import {fileURLToPath} from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url)),checkout=path.resolve(root,"../../../.."),phase=path.resolve(checkout,"../.."),app=path.resolve(phase,"../prd-ui-fixes");
const ts=createRequire(import.meta.url)(path.join(app,"node_modules/typescript/lib/typescript.js"));
const base=path.join(root,"files/services/ingenium-api/lib"),engine=path.join(phase,"parallel/rust-api/docs/workstreams/rust-api/hosted-governance/proposed/hosted-governance.ts");
const core=path.join(base,"__frozen_core__.d.ts"),context=path.join(base,"routes/__frozen_context__.d.ts");
const virtual=new Map([
 [core,'export * from "'+engine+'";\nexport declare function getDb():import("'+engine+'").SqlDb;\ndeclare global{namespace Express{interface Request{principal?:{type:"user";id:string;session?:unknown}|{type:"service"|"compatibility"|"runtime-service";id:string};}}}\n'],
 [context,'import type {Request} from "express";import type {Row,VerifiedNative} from "ingenium-core";export interface VerifiedNativeContextOwner{enrollment(request:Request,requestId:string,actorId:string):VerifiedNative;current(request:Request,grant:Row,recovery:boolean,actorId:string):void;}\n']
]);
virtual.set(core,virtual.get(core)+`
export declare function execTransaction<T>(work:()=>T,retries?:number,mode?:"deferred"|"immediate"):T;
export declare function checkpointAfterWrite():void;
export declare namespace vault {type VaultActor={type:"compatibility"|"user"|"service"|"system";id?:string;requestId?:string};function isSealed():boolean;function decryptItem(projectId:string,itemId:string,actor?:VaultActor):string|null;function updateItem(projectId:string,itemId:string,value:string,actor?:VaultActor):void;}
export declare namespace vault {function deleteItem(projectId:string,itemId:string,actor?:VaultActor):void;}
export declare namespace authorization {type AuthorizationPermission="read"|"write"|"admin"|"execute";interface AuthorizationPrincipal {type:"browser-user"|"user-token"|"service-principal"|"runtime-service"|"compatibility";id:string;scopes:readonly string[];}interface OwnedResource {resourceType:"vault_folder"|"vault_item"|"provider_connection"|"mail_account";resourceId:string;organizationId:string;ownerKind:"user"|"organization";ownerUserId?:string|null;}function requireProjectPermission(p:AuthorizationPrincipal,id:string,resource:string,permission:AuthorizationPermission):{allowed:boolean;visible:boolean};function requireOwnedResourcePermission(p:AuthorizationPrincipal,r:OwnedResource,permission:AuthorizationPermission):{allowed:boolean;visible:boolean};}`);

const auth=path.join(base,"__auth__.d.ts"),policy=path.join(base,"__policy__.d.ts"),csrf=path.join(base,"__csrf__.d.ts");
virtual.set(auth,'import type {Request,RequestHandler} from "express";export declare function authenticateRequestWithoutActivity(req:Request):void;export declare const authMiddleware:RequestHandler;');
virtual.set(policy,'import type {authorization} from "ingenium-core";export declare function toAuthorizationPrincipal(p:unknown):authorization.AuthorizationPrincipal;');
virtual.set(csrf,'import type {RequestHandler} from "express";export declare const csrfMiddleware:RequestHandler;');
virtual.set(core,virtual.get(core)+'export {payloadHash as hostedGovernancePayloadHash} from "'+engine+'";\nexport type {Row as HostedGovernanceRow,VerifiedNative as VerifiedNativeGovernanceContext,SqlDb as HostedGovernanceSqlDb} from "'+engine+'";\n');
virtual.set(core,virtual.get(core)+'export type HostedGovernanceAuthentication=Pick<import("'+engine+'").Ports,"actor"|"allow"|"systemAllowed"|"verifyEnrollment"|"verifyNativeOwner"|"read">;\nexport declare function createHostedGovernanceOwner(authentication:HostedGovernanceAuthentication):ReturnType<typeof import("'+engine+'").createHostedGovernance>;\n');
const options={noEmit:true,strict:true,noUnusedLocals:true,noUnusedParameters:true,skipLibCheck:true,allowImportingTsExtensions:true,esModuleInterop:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,types:["node"],typeRoots:[path.join(app,"node_modules/@types")]};
const host=ts.createCompilerHost(options),get=host.getSourceFile.bind(host);let emitted=0;
host.fileExists=file=>virtual.has(file)||ts.sys.fileExists(file);host.readFile=file=>virtual.get(file)??ts.sys.readFile(file);
host.getSourceFile=(file,language,...rest)=>virtual.has(file)?ts.createSourceFile(file,virtual.get(file),language,true):get(file,language,...rest);
host.resolveModuleNames=(names,from)=>names.map(name=>{
 if(name.endsWith("/middleware/auth.js"))return {resolvedFileName:auth,extension:ts.Extension.Dts};
 if(name.endsWith("/authorization-policy.js"))return {resolvedFileName:policy,extension:ts.Extension.Dts};
 if(name.endsWith("/middleware/csrf.js"))return {resolvedFileName:csrf,extension:ts.Extension.Dts};
 if(name==="../db.js"&&from.endsWith("/node-native-lifecycle.ts"))return {resolvedFileName:core,extension:ts.Extension.Dts};
 if(name==="./hosted-governance.js"&&from.endsWith("/node-native-lifecycle.ts"))return {resolvedFileName:engine,extension:ts.Extension.Ts};
 if(name==="ingenium-core")return {resolvedFileName:core,extension:ts.Extension.Dts};
 if(name==="./routes/native-customize-context.js")return {resolvedFileName:context,extension:ts.Extension.Dts};
 return ts.resolveModuleName(name,from,options,host).resolvedModule??ts.resolveModuleName(name,path.join(app,"services/ingenium-api/__source_check__.ts"),options,host).resolvedModule;
});
host.writeFile=()=>{emitted++;throw new Error("No source check emission");};
const files=[...["native-hosted-connection-owner.ts","node-native-pairing-custody.ts","paired-native-proof.ts","paired-native-reader.ts"].map(n=>path.join(base,n)),path.join(base,"routes/native-customize-pairings.ts"),path.join(base,"routes/native-customize.ts"),path.join(root,"files/packages/ingenium-core/lib/tools/node-native-lifecycle.ts")];
const program=ts.createProgram([...files,core,context],options,host),diagnostics=ts.getPreEmitDiagnostics(program);
for(const d of diagnostics){const where=d.file&&d.start!==undefined?d.file.fileName+":"+(d.file.getLineAndCharacterOfPosition(d.start).line+1)+": ":"";process.stderr.write(where+ts.flattenDiagnosticMessageText(d.messageText,"\n")+"\n");}
console.log(JSON.stringify({privateNodeSourceFiles:files.length,contract:"Frozen Worker5 engine plus exact source auth/vault interfaces; no runtime auth stub; shared vault route remains Root compile gate",diagnostics:diagnostics.length,emitted}));
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(v=>v.isDirectory()?walk(path.join(d,v.name)):[path.join(d,v.name)]);
let syntax=0;for(const file of walk(root+"/files").filter(p=>/\.tsx?$/.test(p))){const source=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);for(const d of source.parseDiagnostics){syntax++;process.stderr.write(file+":"+ts.flattenDiagnosticMessageText(d.messageText,"\n")+"\n");}}
console.log(JSON.stringify({allCanonicalTypeScriptSyntaxDiagnostics:syntax}));if(diagnostics.length||syntax)process.exitCode=1;
