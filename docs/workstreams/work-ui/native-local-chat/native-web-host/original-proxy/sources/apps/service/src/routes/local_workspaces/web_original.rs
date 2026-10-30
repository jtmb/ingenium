//! Original service-side binding producer. No HTTP route or generic native
//! command is installed here: only the private proxy constructor may call it.
use super::*;
use veyra_adapters::opencode::desktop_runtime::{LocalWebLease, NativeWebOriginal, LocalWebPromptInspection};

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
