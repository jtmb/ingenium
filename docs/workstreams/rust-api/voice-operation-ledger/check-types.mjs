import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const integration=process.argv[2];
if(!integration?.startsWith('/'))throw new Error('Explicit existing dependency owner required');
const require=createRequire(resolve(integration,'package.json')),ts=require('typescript');
const root=dirname(fileURLToPath(import.meta.url)),dbPath=resolve(root,'../db.ts');
const dbTypes='export declare function getDb(): unknown; export declare function execTransaction<T>(work:()=>T,retries:number,mode:"deferred"|"immediate"):T; export declare function checkpointAfterWrite():void;';
const options={strict:true,noUncheckedIndexedAccess:true,noEmit:true,incremental:false,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,types:['node'],typeRoots:[resolve(integration,'node_modules/@types')]};
const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
host.readFile=path=>resolve(path)===dbPath?dbTypes:read(path);
host.fileExists=path=>resolve(path)===dbPath||exists(path);
host.writeFile=()=>{throw new Error('No compiler output authorized');};
const program=ts.createProgram(['voice-operation-ledger.ts','voice-operation-cpu.ts','voice-operation-owner.ts','contract-v1.ts'].map(p=>resolve(root,p)),options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
for(const d of diagnostics){const position=d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start):null;process.stdout.write((d.file?.fileName??'')+(position?':'+(position.line+1)+':'+(position.character+1):'')+' '+ts.flattenDiagnosticMessageText(d.messageText,'\n')+'\n');}
if(diagnostics.length)process.exitCode=1;else console.log('PASS strict/noUncheckedIndexedAccess in-memory source typecheck; Core DB signatures declared, no integration/runtime claim');
