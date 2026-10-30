// INSERT inside actual ManagedCpuSupervisor class. New private fields:
// #attachmentLeases = new WeakMap(); #originalProfile;
// Constructor sets #originalProfile=profile before exposing public properties.
// Import ManagedCpuProfile from './managed-profile.mjs' (actual protected loader).
bindAttachmentContext(context) {
 const scope=this.#current;this.#assertAttachmentScope(context,scope);return scope.contextFor(context);
}
captureAttachmentLease(context,scope,callId,deadlineAt) {
 if(typeof callId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(callId)||!Number.isSafeInteger(deadlineAt)
  ||deadlineAt<=Date.now()||deadlineAt>scope?.deadlineAt)fail('CPU_CALL_LEASE_INVALID');
 this.#assertAttachmentScope(context,scope);
 deadlineAt=Math.min(deadlineAt,scope.admission.deadlineAt);if(deadlineAt<=Date.now())fail('CPU_CALL_LEASE_INVALID');
 if(scope.sessions.has(callId)||scope.sessions.size>=16)fail('CPU_CALL_LEASE_CAPACITY');
 const handle=Object.freeze({});scope.sessions.add(callId);
 this.#attachmentLeases.set(handle,{context,scope,callId,deadlineAt,release:null});return handle;
}
#assertAttachmentScope(context,scope) {
 if(!this.isOwnedScope(scope)||this.#current!==scope||!scope.ready||scope.closing||scope.processExited||scope.physicalRetired
  ||!scope.child||!scope.workerBootId||!(this.#originalProfile instanceof ManagedCpuProfile)||!Object.isFrozen(this.#originalProfile)||this.profile!==this.#originalProfile
  ||scope.control?.profileDigest!==this.#originalProfile.profileDigest)fail('CPU_CALL_SCOPE_UNAVAILABLE');
 this.requireCpuAdmission(scope.admission,scope);
 const control=this.ledger.privateRead(scope.contextFor(context),{operationId:scope.controlOperationId,owner:scope.owner});
 if(control.original.kind!=='voice-cpu-supervisor'||control.original.operationId!==scope.controlOperationId||!sameScope(control.original.scope,scope.scope)
  ||control.state!=='running'||control.resourceRetired||!equal(control.owner,scope.owner)||control.control?.workerBootId!==scope.workerBootId
  ||control.control?.profileDigest!==this.#originalProfile.profileDigest)fail('CPU_CALL_CONTROL_UNAVAILABLE');
 if(!scope.health?.voices?.includes(this.#originalProfile.value.defaultVoice))fail('CPU_CALL_VOICE_UNAVAILABLE');
}
inspectAttachmentLease(handle) {
 const original=this.#attachmentLeases.get(handle);
 if(!original||original.release||original.deadlineAt<=Date.now()||!original.scope.sessions.has(original.callId))fail('CPU_CALL_LEASE_REQUIRED');
 this.#assertAttachmentScope(original.context,original.scope);
 return Object.freeze({scope:original.scope.scope,owner:original.scope.owner,controlOperationId:original.scope.controlOperationId,
  profileDigest:this.#originalProfile.profileDigest,defaultVoice:this.#originalProfile.value.defaultVoice,deadlineAt:original.deadlineAt});
}
releaseAttachmentLease(handle) {
 const original=this.#attachmentLeases.get(handle);if(!original)fail('CPU_CALL_LEASE_REQUIRED');
 // Negative cleanup remains possible after authority expires. Only the exact
 // retained lease can release its own session; actual resource retirement stays
 // with releaseSession/stopScope, never any agent execution or goal queue.
 if(!original.release){
  if(!original.scope.sessions.has(original.callId))fail('CPU_CALL_LEASE_REQUIRED');
  original.scope.sessions.delete(original.callId);
  // Exact retained scope, never whichever scope is now #current.
  original.release=original.scope.sessions.size?Promise.resolve():this.stopScope(original.scope,Date.now()+20000);
 }
 return original.release;
}
