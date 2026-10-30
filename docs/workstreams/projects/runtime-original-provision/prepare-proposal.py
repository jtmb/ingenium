"""Exact shared Core/API inputs, delta-only output in owned source root.
Root alone registers/applies SQL127 and the reviewed source proposal.
"""
from pathlib import Path
import argparse,json,hashlib,difflib,subprocess
parser=argparse.ArgumentParser();parser.add_argument('--core-source-root',required=True);parser.add_argument('--recorded-git-preimage',action='store_true',help='Explicit historical proposal regeneration; never an apply check against current shared files');args=parser.parse_args()
root=Path(args.core_source_root);owned=Path(__file__).resolve().parent;inputs=json.loads((owned/'inputs.json').read_text())
assert root.is_absolute() and root.resolve()==root
original={}
for item in inputs['inputs']:
 raw=subprocess.run(['git','show',inputs['head']+':'+item['path']],cwd=root,check=True,capture_output=True).stdout if args.recorded_git_preimage else (root/item['path']).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=item['sha256']:raise RuntimeError('shared source drift; no fallback: '+item['path'])
 original[item['path']]=raw.decode()
changed=dict(original)
def replace(rel,before,after):
 if changed[rel].count(before)!=1:raise RuntimeError('exact producer anchor drift: '+rel+' '+before[:80])
 changed[rel]=changed[rel].replace(before,after,1)
rel='packages/ingenium-core/lib/tools/runtimes.ts'
replace(rel,'import { coordinationWorktreeId } from "./coordination.js";',"""import { coordinationWorktreeId } from "./coordination.js";
import {insertRuntimeOriginalProvision,readRuntimeOriginalProvision,type RuntimeOriginalProvision,type StoredRuntimeOriginalProvision} from "./runtime-original-provision.js";
export {originalProvisionFromNewFlow,publicProvisionRequest,publicProvisionSpec,decodeRuntimeOriginalProvision,validateProvisionResponse,provisionHash} from "./runtime-original-provision.js";
export type {RuntimeOriginalProvision,StoredRuntimeOriginalProvision,PublicProvisionRequest} from "./runtime-original-provision.js";
/** Immutable original metadata only; fresh healthy job-role qualification is separate. */
export function getRuntimeOriginalProvision(id:string):StoredRuntimeOriginalProvision|undefined{
 return readRuntimeOriginalProvision(getDb(process.env.INGENIUM_CORE_DB_PATH),id);
}""")
replace(rel,'  state: RuntimeState; revision: number; lease_expires_at: string | null; idle_expires_at: string | null;', '  state: RuntimeState; revision: number; lease_owner_hash: string | null; lease_expires_at: string | null; idle_expires_at: string | null;')
replace(rel,'  backendContainerId?: string | null; idleExpiresAt?: Date | null; absoluteExpiresAt?: Date | null; maxActiveRuntimes?: number;', '  backendContainerId?: string | null; idleExpiresAt?: Date | null; absoluteExpiresAt?: Date | null; maxActiveRuntimes?: number;\n  originalProvision?: RuntimeOriginalProvision;')
replace(rel,'    const revoked = input.toState === "REVOKED";', '    insertRuntimeOriginalProvision(db,current,input,timestamp); // same original STARTING transaction\n    const revoked = input.toState === "REVOKED";')
rel='services/ingenium-api/lib/runtime-manager-contract.ts'
replace(rel,'export interface RuntimeProvisionRequest {','export interface RuntimeProvisionRequest {\n  originalRequestId?: string; // new private flow only; no legacy adoption')
rel='services/ingenium-api/scripts/runtime-manager.ts'
replace(rel,'import { timingSafeEqual } from "node:crypto";', '''import { timingSafeEqual } from "node:crypto";\nimport * as runtimeProvision from 'ingenium-core/lib/tools/runtime-original-provision';''')
replace(rel,'  Name?: string;','  Name?: string;\n  Image?: string;')
needle='async function provisionRuntime(input: RuntimeProvisionRequest, mappings: ReturnType<typeof readWorkspaceMappings>): Promise<DockerInspect> {'
replace(rel,needle,"""// Only the original private POST new-create flow populates this map. Inspect,
// labels or a replayed/current container cannot construct an original receipt.
const originalProvisionResponses=new WeakMap<DockerInspect,{disposition:"new_created"|"existing_reused"|"legacy_unqualified";original:runtimeProvision.RuntimeOriginalProvision|null}>();
"""+needle)
replace(rel,'  const spec = buildRuntimeContainerSpec(input, mapping, config);','  let spec = buildRuntimeContainerSpec(input, mapping, config);')
replace(rel,'    if (exact && prior.State?.Status === "running") return prior;', '    if (exact && prior.State?.Status === "running") {originalProvisionResponses.set(prior,{disposition:"existing_reused",original:null});return prior;}')
# Original candidate starts only after existing-container handling. Neither an
# image observation nor a valid request can mint a receipt before NEW effects.
needle="""  try {
    const created = await dockerRequest<{ Id?: string }>("POST", `/containers/create?name=${encodeURIComponent(input.backendName)}`, spec);"""
replace(rel,needle,"""  let originalCandidate:{daemon:{ID?:string};imageId:string}|null=null;
  if(input.originalRequestId){
    try{
      runtimeProvision.publicProvisionRequest({...input,originalRequestId:input.originalRequestId});
      const daemon=await dockerRequest<{ID?:string}>("GET","/info");
      const image=await dockerRequest<{Id?:string}>("GET",`/images/${encodeURIComponent(config.image)}/json`);
      if(daemon.status!==200||!daemon.data?.ID||image.status!==200||!/^sha256:[a-f0-9]{64}$/.test(image.data?.Id??""))throw Error("Original provision prerequisites unavailable");
      originalCandidate={daemon:daemon.data,imageId:image.data!.Id!};
      spec={...spec,Image:originalCandidate.imageId}; // immutable create image
    }catch{/* Preserve legacy lifecycle, but never qualify without an original. */}
  }
  try {
    const created = await dockerRequest<{ Id?: string }>("POST", `/containers/create?name=${encodeURIComponent(input.backendName)}`, spec);""")
replace(rel,"""    if (!ready) throw new Error("Runtime disappeared after start");
    return ready;""","""    if (!ready) throw new Error("Runtime disappeared after start");
    originalProvisionResponses.set(ready,{disposition:"legacy_unqualified",original:null});
    if(originalCandidate){
      try{
        const daemonAfter=await dockerRequest<{ID?:string}>("GET","/info");
        if(daemonAfter.status!==200||!daemonAfter.data)throw Error("Original daemon unavailable");
        const original=runtimeProvision.originalProvisionFromNewFlow({request:{...input,originalRequestId:input.originalRequestId!},spec,
          daemonBefore:originalCandidate.daemon,daemonAfter:daemonAfter.data,imageId:originalCandidate.imageId,createdId:created.data?.Id,
          createStatus:created.status,startStatus:started.status,attachJoined:true,container:ready});
        originalProvisionResponses.set(ready,{disposition:"new_created",original});
      }catch{/* A missing/changed birth witness refuses Dot qualification only. */}
    }
    return ready;""")
replace(rel,'response.writeHead(202).end(JSON.stringify({ data: publicInspect(inspect) }));',"""const original=originalProvisionResponses.get(inspect);
        response.writeHead(202).end(JSON.stringify({data:{...publicInspect(inspect),
          provisionDisposition:original?.disposition??"legacy_unqualified",originalProvision:original?.original??null}}));""")
rel='services/ingenium-api/lib/runtime-manager-client.ts'
replace(rel,'import type { runtimes } from "ingenium-core";',"import type { runtimes } from \"ingenium-core\";\nimport * as runtimeProvision from 'ingenium-core/lib/tools/runtime-original-provision';\nimport {randomUUID} from \"node:crypto\";")
a=changed[rel].index('export function provisionManagedRuntime(');z=changed[rel].index('\nexport function inspectManagedRuntime(',a)
block=changed[rel][a:z]
block=block.replace('export function provisionManagedRuntime(', 'export async function provisionManagedRuntime(')
block=block.replace('  return requestManager("/v1/runtimes", "POST", {','  const originalRequestId=randomUUID();\n  const managerRequest={\n    originalRequestId,')
assert block.endswith('  });\n}\n')
block=block[:-len('  });\n}\n')]+"""  };
  const result=await requestManager("/v1/runtimes","POST",managerRequest);
  const fields=result as RuntimeManagerInspect&{provisionDisposition?:unknown;originalProvision?:unknown};
  // Only this immediate authenticated response plus this exact local request
  // can create an entry. A copied DTO/current probe has no WeakMap identity.
  if(fields.provisionDisposition==="new_created"){
    try{originalProvisionReceipts.set(result,runtimeProvision.validateProvisionResponse(fields.originalProvision,managerRequest,result.backendId));}
    catch{/* Preserve ordinary runtime lifecycle; no original role authority. */}
  }
  delete fields.originalProvision;delete fields.provisionDisposition;
  return result;
}
"""
prefix="""const originalProvisionReceipts=new WeakMap<RuntimeManagerInspect,runtimeProvision.RuntimeOriginalProvision>();
/** No DTO constructor: only the same object returned by private authenticated POST. */
export function authenticatedOriginalProvision(result:RuntimeManagerInspect):runtimeProvision.RuntimeOriginalProvision|undefined{return originalProvisionReceipts.get(result);}
"""
changed[rel]=changed[rel][:a]+prefix+block+changed[rel][z:]
rel='services/ingenium-api/lib/runtime-provisioner.ts'
replace(rel,'import { provisionManagedRuntime,', 'import { authenticatedOriginalProvision, provisionManagedRuntime,')
needle="""      backendContainerId: managed.backendId ?? null,
    });"""
replace(rel,needle,"""      backendContainerId: managed.backendId ?? null,
      originalProvision: authenticatedOriginalProvision(managed),
    });""")
patch=[];proof=[]
for rel,before in original.items():
 after=changed[rel]
 proof.append({'path':rel,'baseSha256':hashlib.sha256(before.encode()).hexdigest(),'proposedSha256':hashlib.sha256(after.encode()).hexdigest()})
 patch.extend(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
raw=''.join(patch);(owned/'integration.patch').write_text(raw)
new=[]
for file in sorted((owned/'sources').rglob('*')):
 if file.is_file():new.append({'path':str(file.relative_to(owned/'sources')),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
(owned/'proposal.json').write_text(json.dumps({'sourceHead':inputs['head'],'existingInputs':proof,'canonicalNewSources':new,'patchSha256':hashlib.sha256(raw.encode()).hexdigest(),'ddlAllocation':127,'ddlSha256':hashlib.sha256((owned/'DDL127.sql').read_bytes()).hexdigest(),'ddlRegisteredOrApplied':False,'sharedWritten':False,'compiled':False,'runtimeOrDockerInvoked':False,'originalReadExport':'runtimes.getRuntimeOriginalProvision(runtimeId)','metadataReadIsQualification':False,'freshHealthyQualificationOwner':'existing Core126 image owner; Root adds imageId/startIdentity equality'},indent=2)+'\n')
print(json.dumps({'existingDeltas':len(proof),'canonicalNewSources':len(new),'patchBytes':len(raw.encode())}))
