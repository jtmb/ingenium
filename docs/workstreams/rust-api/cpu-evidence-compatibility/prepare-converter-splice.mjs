import fs from 'node:fs';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
const root=process.argv[2];if(!root?.startsWith('/'))throw Error('Explicit current read-only integration root required');
const sha=v=>createHash('sha256').update(v).digest('hex'),path='docs/workstreams/voice/cpu-qualification/evidence-to-approval.mjs';
const before=fs.readFileSync(root+'/'+path,'utf8');if(sha(before)!=='148251806cf9333209822b17ddd93941b5f17d84d4c65622fa1fb9d62550a86f')throw Error('Exact converter preimage drift');let after=before;
const replace=(a,b)=>{if(after.split(a).length!==2)throw Error('Missing/ambiguous exact splice '+a.slice(0,60));after=after.replace(a,b);};
replace("import { createHash, randomUUID } from 'node:crypto';", "import { createHash, randomUUID } from 'node:crypto';\nimport {projectCapturedConfiguration,assertStableConfiguration,assertKernelEnvironment,assertCaptureDecoder} from './capture-projection.mjs';\nimport {parseStrictJobJson} from '../../../../services/ingenium-api/lib/dot-v2/job-bootstrap-frame.mjs';");
replace("value: JSON.parse(input.bytes.toString('utf8'))",'value: parseStrictJobJson(input.bytes,1048576)');
replace('function run(path, expectedCase, bindings) {',`function run(path, expectedCase, review, closureSha256) {
  const descriptor=review.captureDecoders?.[expectedCase];assertCaptureDecoder(descriptor,expectedCase);`);
replace('|| value.exit?.code !== 0 || value.exit.signal || canonical(value.bindings) !== canonical(bindings))','|| value.exit?.code !== 0 || value.exit.signal)');
replace('  return { ...capture, owner, events, stdoutSha256:',`  const grant=json(descriptor.grantPath);
  const projection=projectCapturedConfiguration({capture:value,captureSha256:capture.sha256,grant:grant.value,grantSha256:grant.sha256,descriptor,review,closureSha256,events});
  return { ...capture, owner, events, projection, stdoutSha256:`);
replace('.map(s => JSON.parse(s));','.map(s => parseStrictJobJson(Buffer.from(s),1048576));');
replace("r.kind !== 'root-cpu-qualification-review-v1'","r.kind !== 'root-cpu-qualification-review-v2'");
replace("  const { ManagedCpuProfile } = await import(pathToFileURL(profileModule));","  assertStableConfiguration(r.bindings);assertKernelEnvironment(r.kernelEnvironment);\n  const { ManagedCpuProfile } = await import(pathToFileURL(profileModule));");
for(const [field,name]of [['coldHot','model-cold-hot'],['helper','helper'],['witness','witness'],['probe','probe'],['wire','production-wire']])replace("run(r.cases."+field+", '"+name+"', r.bindings)","run(r.cases."+field+", '"+name+"', r, closure.sha256)");
replace('r.bindings.kernelBootId !== cold.owner.bootId','r.kernelEnvironment.bootId !== cold.owner.bootId');
replace('cases: [cold, helper, witness, probe, wire].map(e => ({ receipt: e.sha256, stdout: e.stdoutSha256, stderr: e.stderrSha256 }))','projectionSchema: "root-cpu-configuration-v1", configuration: r.bindings, kernelEnvironment: r.kernelEnvironment,\n      cases: [cold, helper, witness, probe, wire].map(e => ({ receipt: e.sha256, grant: e.projection.rawGrantSha256, decoder: e.projection.decoder, projection: e.projection.projectionSha256, stdout: e.stdoutSha256, stderr: e.stderrSha256 }))');
if(process.env.CHECK_CONVERTER_SYNTAX==='1'){const{SourceTextModule}=await import('node:vm');new SourceTextModule(after);console.log('PASS proposed converter syntax only; module not evaluated');}
const changes=[{path,before,after},{path:'docs/workstreams/voice/cpu-qualification/capture-projection.mjs',before:'',after:fs.readFileSync(new URL('capture-projection.mjs',import.meta.url),'utf8'),expectedAbsent:true}];
const py="import json,sys,difflib\nfor c in json.load(sys.stdin):\n sys.stdout.writelines(difflib.unified_diff(c['before'].splitlines(True),c['after'].splitlines(True),fromfile='/dev/null' if c.get('expectedAbsent') else 'a/'+c['path'],tofile='b/'+c['path'],n=3))\n";
const output=spawnSync('python3',['-c',py],{input:JSON.stringify(changes),encoding:'utf8',maxBuffer:1048576});if(output.status!==0)throw Error('Patch render failed');fs.writeFileSync(new URL('converter-projection.patch',import.meta.url),output.stdout);
const manifest={scope:'Owned source proposal only; unknown helper/witness/wire fail closed, no approval generated',patchSha256:sha(output.stdout),changes:changes.map(c=>({path:c.path,expectedAbsent:!!c.expectedAbsent,preimageSha256:c.expectedAbsent?null:sha(c.before),proposedSha256:sha(c.after)})),strictParser:{path:'services/ingenium-api/lib/dot-v2/job-bootstrap-frame.mjs',sha256:sha(fs.readFileSync(root+'/services/ingenium-api/lib/dot-v2/job-bootstrap-frame.mjs'))}};fs.writeFileSync(new URL('converter-preimages.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
