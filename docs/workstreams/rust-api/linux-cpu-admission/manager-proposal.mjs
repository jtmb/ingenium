import {execFileSync} from 'node:child_process';
export const managerBase='5c41af5e';
export function managerChanges(root){
 const read=path=>execFileSync('git',['-C',root,'show',managerBase+':'+path],{encoding:'utf8',maxBuffer:2*1024*1024});
 const path='services/ingenium-api/lib/voice-v2/managed-supervisor.mjs',before=read(path);let after=before;
 const replace=(from,to)=>{if(after.split(from).length!==2)throw new Error('Manager exact anchor mismatch: '+from.slice(0,80));after=after.replace(from,to);};
 replace('admitCpu, requireCpuAdmission, releaseCpu, fetch:','admitCpu, requireCpuAdmission, releaseCpu, admitCpuWitness, releaseCpuWitness, fetch:');
 replace('[bindContext, admitCpu, requireCpuAdmission, releaseCpu, request, launch]','[bindContext, admitCpu, requireCpuAdmission, releaseCpu, admitCpuWitness, releaseCpuWitness, request, launch]');
 replace('    const scope = this.#scopes.get(request.owner?.ownerId);',"    const scope = action === 'retireOriginal' ? this.#proofs.get(request.physicalProof)?.scope : this.#scopes.get(request.owner?.ownerId);");
 replace('{ profile, ledger, bindContext, admitCpu, requireCpuAdmission, releaseCpu, request, launch, nodeBootId:', '{ profile, ledger, bindContext, admitCpu, requireCpuAdmission, releaseCpu, admitCpuWitness, releaseCpuWitness, request, launch, nodeBootId:');
 replace('  #scope(context, input, deadlineAt, ownerGeneration = 1) {',`  /** Read-only actual proof registry. Never accepts serialized booleans/PID/health/timeout evidence. */
  inspectResourceRetirement(input) {
    const proof=this.#proofs.get(input),scope=proof?.scope;
    if(!proof||!scope)fail('CPU_RESOURCE_RETIREMENT_PRODUCER_REQUIRED');
    if(proof.kind==='physical'&&scope.physicalRetired) return Object.freeze({manager:this,scope,owner:scope.owner,admission:scope.admission,
      retired:true,kind:!scope.recovered&&!scope.started&&scope.child===null?'sealed-before-fork':'physical'});
    if(proof.kind==='witness-retired'||proof.kind==='witness-before-fork') return Object.freeze({manager:this,scope,owner:scope.owner,
      admission:proof.admission,retired:true,kind:proof.kind});
    fail('CPU_RESOURCE_RETIREMENT_PRODUCER_REQUIRED');
  }
  #scope(context, input, deadlineAt, ownerGeneration = 1) {`);
 replace("if (this.#current?.ready && !this.#current.closing && sameScope(this.#current.scope, requestedScope)) {", "if (this.#current?.ready && !this.#current.closing && sameScope(this.#current.scope, requestedScope)) {\n      this.requireCpuAdmission(this.#current.admission,this.#current);");
 replace("  async #witness(scope, deadlineAt, requireParentExit) {\n    const child = this.launch",`  async #witness(scope, deadlineAt, requireParentExit) {
    const admission=await this.admitCpuWitness({context:scope.context,scope,profileDigest:this.profile.profileDigest,deadlineAt});
    scope.witnessAdmission=admission;let launchCalled=false;
    try {
    this.requireCpuAdmission(admission,scope);
    if(!Number.isSafeInteger(admission.deadlineAt)||admission.deadlineAt<=Date.now())fail('CPU_RESOURCE_DEADLINE_REQUIRED');
    deadlineAt=Math.min(deadlineAt,admission.deadlineAt);launchCalled=true;
    const child = this.launch`);
 replace("    const result = await this.#deadline(Promise.all([scope.witness.exited, scope.witness.closed, scope.witness.stdout, scope.witness.stderr, scope.witnessInput]), deadlineAt);",`    scope.witnessReleaseOriginal=Promise.all([scope.witness.exited,scope.witness.closed,scope.witness.stdout,scope.witness.stderr,scope.witnessInput]).then(async result=>{
      const proof={};this.#proofs.set(proof,{kind:'witness-retired',scope,admission});
      await this.releaseCpuWitness(admission,proof,this);return result;
    });
    scope.witnessReleaseOriginal.catch(error=>{scope.witnessReleaseFailure??=error;});
    const result=await this.#deadline(scope.witnessReleaseOriginal,deadlineAt);`);
 replace('    return proof;\n  }\n  async #recoverControl',`    return proof;
    } catch(error) {
      if(!launchCalled){const proof={};this.#proofs.set(proof,{kind:'witness-before-fork',scope,admission});
        try{await this.releaseCpuWitness(admission,proof,this);}catch(releaseError){scope.witnessReleaseFailure??=releaseError;}}
      throw error;
    }
  }
  async #recoverControl`);
 replace('    this.ledger.retireOriginal(scope.contextFor(context), { operationId: scope.controlOperationId, owner: scope.owner, physicalProof: proof });\n  }\n  stopScope', '    this.ledger.retireOriginal(scope.contextFor(context), { operationId: scope.controlOperationId, owner: scope.owner, physicalProof: proof });\n    await this.releaseCpu(scope.admission,proof,this);\n  }\n  stopScope');
 const typePath='services/ingenium-api/lib/voice-v2/managed-supervisor.d.mts',types=read(typePath);
 const typeAfter=types.replace('  releaseCpu(admission: CpuAdmission | null, proof: object, producer: ManagedCpuSupervisor<C>): void | Promise<void>;',`  releaseCpu(admission: CpuAdmission | null, proof: object, producer: ManagedCpuSupervisor<C>): void | Promise<void>;
  admitCpuWitness(input: {context:C;scope:SupervisedCpuScope<C>;profileDigest:string;deadlineAt:number}):CpuAdmission|Promise<CpuAdmission>;
  releaseCpuWitness(admission:CpuAdmission,proof:object,producer:ManagedCpuSupervisor<C>):void|Promise<void>;`)
  .replace('  status(): CpuSupervisorStatus;','  status(): CpuSupervisorStatus;\n  inspectResourceRetirement(proof:object):Readonly<{manager:ManagedCpuSupervisor<C>;scope:SupervisedCpuScope<C>;owner:voiceOperations.VoiceOwner;admission:CpuAdmission|null;retired:true;kind:"physical"|"sealed-before-fork"|"witness-retired"|"witness-before-fork"}>;');
 if(types===typeAfter)throw new Error('Manager type anchors missing');
 return [{path,before,after},{path:typePath,before:types,after:typeAfter}];
}
