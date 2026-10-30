// INSERT inside ManagedCpuSupervisor. Private field: #attachmentBootstraps=new WeakMap();
  beginOriginalAttachmentScope({context,scope,deadlineAt,signal}) {
    const requested=Object.freeze({...validateScope(scope)});
    if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now()||!(signal instanceof AbortSignal))fail('CPU_ATTACHMENT_BOOTSTRAP_INPUT');
    signal.throwIfAborted();
    const handle=Object.freeze({}),controller=new AbortController();
    const record={context,scope:null,sessionId:'attachment-bootstrap:'+randomUUID(),controller,signal,
      abort:null,work:null,release:null,released:false,failure:null};
    record.abort=()=>controller.abort(signal.reason);
    // The actual record and pending work are published before #queueScope can
    // call #open, recovery, admission, reservation, network or spawn.
    this.#attachmentBootstraps.set(handle,record);
    record.work=Promise.resolve().then(()=>{
      controller.signal.throwIfAborted();
      return this.#queueScope({context,scope:requested,sessionId:record.sessionId,deadlineAt,signal:controller.signal},record);
    });
    record.work.catch(error=>{record.failure??=error;});
    signal.addEventListener('abort',record.abort,{once:true});
    if(signal.aborted)record.abort();
    return handle;
  }
  async waitOriginalAttachmentScope(handle,signal) {
    const record=this.#attachmentBootstraps.get(handle);
    if(!record||record.released||!(signal instanceof AbortSignal))fail('CPU_ATTACHMENT_BOOTSTRAP_ORIGINAL_REQUIRED');
    const abort=()=>record.controller.abort(signal.reason);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    try {
      const status=await record.work;
      record.controller.signal.throwIfAborted();signal.throwIfAborted();
      this.#requireAttachmentBootstrap(record);return status; // status DATA, never authority
    } catch(error) {
      try{await this.releaseOriginalAttachmentScope(handle);}catch(cleanup){
        record.failure??=cleanup;throw Object.assign(Error('CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN'),{code:'CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN',cause:cleanup});
      }
      throw error;
    } finally {signal.removeEventListener('abort',abort);}
  }
  #requireAttachmentBootstrap(record) {
    const scope=record.scope;
    if(record.released||record.controller.signal.aborted||!scope||!this.isOwnedScope(scope)
      ||!scope.ready||scope.closing||scope.physicalRetired||!scope.sessions.has(record.sessionId))fail('CPU_ATTACHMENT_BOOTSTRAP_NOT_READY');
    this.requireCpuAdmission(scope.admission,scope);return scope;
  }
  bindOriginalAttachmentScope(handle,freshActualContext) {
    const record=this.#attachmentBootstraps.get(handle);if(!record)fail('CPU_ATTACHMENT_BOOTSTRAP_ORIGINAL_REQUIRED');
    const scope=this.#requireAttachmentBootstrap(record);
    // Genuine bindContext validates actual context against exact retained scope.
    // Neither #current nor a caller-supplied observer/scope participates.
    return this.bindContext(freshActualContext,scope,this);
  }
  releaseOriginalAttachmentScope(handle) {
    const record=this.#attachmentBootstraps.get(handle);if(!record)fail('CPU_ATTACHMENT_BOOTSTRAP_ORIGINAL_REQUIRED');
    if(record.release)return record.release;
    record.released=true;record.controller.abort();
    record.signal.removeEventListener('abort',record.abort);
    record.release=Promise.resolve().then(async()=>{
      // Join the enrolled original even if it was still queued or admitting.
      await record.work.catch(()=>undefined);
      const scope=record.scope;if(!scope)return;
      if(scope.cleanupFailure||scope.retentionFailure||scope.releaseFailure)
        throw Object.assign(Error('CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN'),{code:'CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN'});
      scope.sessions.delete(record.sessionId);
      if(scope.sessions.size)return;
      if(scope.physicalRetired){if(!scope.busy)this.#scopes.delete(scope.owner.ownerId);return;}
      if(!scope.child)fail('CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN');
      await this.stopScope(scope,Date.now()+20000); // exact original, never #current
    });
    record.release.catch(error=>{record.failure??=error;});return record.release;
  }
