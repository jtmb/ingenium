import {extractActualBootstrap} from './actual-bootstrap-source.mjs';
const app=process.env.VEYRA_SOURCE_APP;if(!app)throw Error('Explicit existing APP required');
const p=extractActualBootstrap(app),ts=p.ts;
const options={strict:true,noUncheckedIndexedAccess:true,noEmit:true,incremental:false,skipLibCheck:true,esModuleInterop:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,types:['node'],typeRoots:[app+'/node_modules/@types']};
const host=ts.createCompilerHost(options);host.writeFile=()=>{throw Error('No compiler output authorized');};
const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([p.path],options,host));
for(const d of diagnostics)console.log((d.file?.fileName??'')+(d.start===undefined?'':':'+(d.file.getLineAndCharacterOfPosition(d.start).line+1))+' '+ts.flattenDiagnosticMessageText(d.messageText,' '));
if(diagnostics.length)process.exitCode=1;else console.log('PASS CURRENT complete actual db.ts strict/noUncheckedIndexedAccess/noEmit; SHA256 '+p.sha256);
