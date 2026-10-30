//! Original service-side binding producer. No HTTP route or generic native
//! command is installed here: only the private proxy constructor may call it.
use super::*;
use veyra_adapters::opencode::desktop_runtime::{LocalWebLease, NativeWebOriginal, LocalWebPromptInspection};
use veyra_adapters::{opencode::desktop_runtime::{LocalWebPromptOutcome,LocalWebOriginalSubmission},projects::NativeWebAcknowledgement};

#[derive(Default)]
struct PendingState {outcomes:Vec<Arc<LocalWebPromptOutcome>>,fused:bool}
/// Publication completions only, not another Run or execution queue. The
/// original worker enrolls its actual response before its join result can be
/// dropped on HTTP disconnect. Writer faults retain exact private bytes.
#[derive(Default)]
pub(super) struct WebPending {state:Mutex<PendingState>}
impl WebPending {
    fn enroll(&self,outcome:LocalWebPromptOutcome)->Result<(),String>{
        let outcome=Arc::new(outcome);
        match self.state.lock(){
            Ok(mut state)=>{
                if state.outcomes.iter().any(|old|old.operation_id()==outcome.operation_id()){state.fused=true;}
                state.outcomes.push(outcome);
                if state.fused{Err("Original Web response publication is fused; exact outcomes retained".into())}else{Ok(())}
            },
            Err(poison)=>{
                // Retention-only poison recovery. Never authorize a request or
                // publish guessed state through a poisoned registry.
                let mut state=poison.into_inner();state.fused=true;state.outcomes.push(outcome);
                Err("Original Web response registry is poisoned; exact outcome retained".into())
            }
        }
    }
    pub(super) fn check_empty(&self)->Result<(),String>{
        let state=self.state.lock().map_err(|_|"Original Web response registry poisoned")?;
        if state.fused||!state.outcomes.is_empty(){return Err("Original Web response publication remains retained".into())}Ok(())
    }
    pub(super) fn flush(&self,service:&ServiceState,deadline:Instant)->Result<(),String>{
        let mut writer=service.projects.try_lock().map_err(|_|"Original Web response writer busy")?;
        let store=writer.as_mut().ok_or("Original Web response writer retired")?;
        let mut pending=self.state.lock().map_err(|_|"Original Web response registry poisoned")?;
        if pending.fused{return Err("Original Web response registry fused; preserve all outcomes".into())}
        let mut failed=false;let mut index=0;
        while index<pending.outcomes.len(){
            if Instant::now()>=deadline{failed=true;break;}
            if store.acknowledge_native_web_prompt(&pending.outcomes[index],&service.instance_id).is_ok(){pending.outcomes.remove(index);}
            else{failed=true;index+=1;}
        }
        if failed||!pending.outcomes.is_empty(){return Err("Original Web responses remain retained for the original writer".into())}Ok(())
    }
}

/// Called only by the native-authenticated private proxy. No public /operations
/// DTO/route is added. Uses the SAME service serial as main_prompt/model work.
pub(in crate::routes) async fn submit_prompt(state:Arc<ServiceState>,binding:Arc<LocalWorkspaceBinding>,
    lease:Arc<LocalWebLease>,original:NativeWebOriginal)->Result<NativeWebAcknowledgement,String>{
    let serial=tokio::time::timeout(Duration::from_secs(5),state.serial.clone().lock_owned()).await
        .map_err(|_|"Original Web admission is busy; no effect admitted")?;
    tokio::task::spawn_blocking(move||{
        let _serial=serial;
        check(&state,&binding,&lease)?;
        if state.local_workspaces.web.check_empty().is_err(){
            state.local_workspaces.web.flush(&state,Instant::now()+Duration::from_secs(5))?;
        }
        let operation=original.operation_id().to_owned();
        // Exact stable retry reads before today's skills/model/file capture.
        let retained={
            let writer=state.projects.try_lock().map_err(|_|"Original Web writer busy")?;
            let store=writer.as_ref().ok_or("Original Web writer retired")?;
            store.lookup_native_web_original(&original,&state.instance_id).map_err(|_|"Original Web request conflicts")?
        };
        if let Some(retained)=retained{
            let writer=state.projects.try_lock().map_err(|_|"Original Web writer busy")?;
            return writer.as_ref().ok_or("Original Web writer retired")?.read_native_web_acknowledgement(binding.owner(),lease.session_id(),&retained.request_id,&state.instance_id)
                .map_err(|_|"Original Web response read refused")?.ok_or_else(||"Original Web outcome or forgotten response remains unavailable; no effect repeated".into());
        }
        if state.draining.load(Ordering::Acquire)||*state.shutdown.borrow(){return Err("Original Web admission closed".into());}
        state.local_workspaces.web.check_empty()?;
        if state.model_work.check_idle_until(Instant::now()+Duration::from_secs(5)).is_err()
            ||state.model_operation_workers.has_retained()!=Ok(false){return Err("Finish original model ownership before Web input".into());}
        {
            let writer=state.projects.try_lock().map_err(|_|"Original Web writer busy")?;
            writer.as_ref().ok_or("Original Web writer retired")?.require_no_unknown_native_web_original(&binding.owner().workspace_id)
                .map_err(|_|"Reconcile original Web uncertainty before another effect")?;
        }
        let current=||check_saved(&state,&binding,lease.session_id());
        let result=state.live_agent.submit_local_web_prompt_original(&lease,original,&current,|original,effective,files|{
            // Nonblocking writer acquisition preserves existing engine/catalog
            // lock order; Root's original store, never a positive port/boolean.
            let mut writer=state.projects.try_lock().map_err(|_|"Original Web writer busy")?;
            writer.as_mut().ok_or("Original Web writer retired")?.reserve_native_web_original(original,effective,files,&state.instance_id)
                .map_err(|_|"Original Web transaction/fence refused".into())
        })?;
        let settled_operation=match result{
            LocalWebOriginalSubmission::Sent(outcome)=>{
                state.local_workspaces.web.enroll(outcome)?;
                state.local_workspaces.web.flush(&state,Instant::now()+Duration::from_secs(5))?;
                operation
            },
            LocalWebOriginalSubmission::Retained(receipt)=>receipt.request_id
        };
        let writer=state.projects.try_lock().map_err(|_|"Original Web writer busy")?;
        writer.as_ref().ok_or("Original Web writer retired")?.read_native_web_acknowledgement(binding.owner(),lease.session_id(),&settled_operation,&state.instance_id)
            .map_err(|_|"Original Web response read refused")?.ok_or_else(||"Original Web outcome remains unknown; no effect repeated".into())
    }).await.map_err(|_|"Original Web worker ended; preserve original uncertainty")?
}

/// Same original store for every callback. No callback supplied by a renderer,
/// alternate writer, cached boolean, descriptor or downstream proxy port.
fn check_saved(state: &ServiceState, binding: &LocalWorkspaceBinding, session: &str) -> Result<(), String> {
    let guard = state.projects.try_lock().map_err(|_| "original local session writer busy")?;
    let store = guard.as_ref().ok_or("original local session writer retired")?;
    binding.verify_current(store, &state.instance_id)?;
    store.require_local_session(&binding.owner().workspace_id, session)
        .map_err(|_| "original private session ownership changed")?;
    Ok(())
}

/// Called after original native child + private origin authentication, not
/// renderer-provided positive authority. Owner/session are expectations only;
/// actual current registry and retained engine create the opaque lease.
pub(in crate::routes) fn acquire(state: &ServiceState,
    expected: &veyra_contracts::local_workspaces::LocalWorkspaceOwner, session: &str,
) -> Result<(Arc<LocalWorkspaceBinding>, LocalWebLease), String> {
    let binding = with_store(state, |store| {
        store.require_local_session(&expected.workspace_id, session)
            .map_err(|_| "private session is not owned by the original writer")?;
        LocalWorkspaceBinding::acquire(store, expected, &state.instance_id)
    })?;
    let current = || check_saved(state, &binding, session);
    current()?;
    let lease = state.live_agent.mint_local_web_lease(binding.clone(), session, &current)?;
    current()?;
    Ok((binding, lease))
}

pub(in crate::routes) fn check(state: &ServiceState, binding: &LocalWorkspaceBinding, lease: &LocalWebLease) -> Result<(), String> {
    if binding.owner() != lease.owner() { lease.revoke(); return Err("private Web owner changed".into()); }
    state.live_agent.check_local_web_lease(lease, &||check_saved(state,binding,lease.session_id()))
}

/// Inputs come from the private proxy's received request, after native-only
/// auth validation and stripping ambient transport headers. No Web effect.
pub(in crate::routes) fn capture(state: &ServiceState, binding: &LocalWorkspaceBinding,
    lease: &LocalWebLease, method: &str, target: &str,
    content_headers: &[(String,String)], body: Vec<u8>,
) -> Result<NativeWebOriginal, String> {
    check(state,binding,lease)?;
    state.live_agent.capture_local_web_request(lease,method,target,content_headers,body,
        &||check_saved(state,binding,lease.session_id()))
}

/// Inspection is never journal admission. Root must repeat under the actual
/// dispatch guard after original ModelWork/queue/broker reservation + fence.
pub(in crate::routes) fn inspect_prompt(state: &ServiceState, binding: &LocalWorkspaceBinding,
    lease: &LocalWebLease, original: &NativeWebOriginal,
) -> Result<LocalWebPromptInspection,String> {
    check(state,binding,lease)?;
    state.live_agent.inspect_local_web_prompt(lease,original,
        &||check_saved(state,binding,lease.session_id()))
}
