//! Child of routes::local_workspaces::web_original. No public route installed.
use super::*;
use axum::body::Body;
use futures_util::StreamExt;
/// A concrete consumer of the actual received Body, not an already-built Vec.
/// Call ONLY inside the original native-child + private-origin authenticated
/// handler. Local bearer/LocalRequest alone is insufficient child authority.
pub(super) async fn receive_prompt(
 state:Arc<ServiceState>,binding:Arc<LocalWorkspaceBinding>,lease:Arc<LocalWebLease>,
 method:&str,target:&str,headers:&[(String,String)],body:Body,
)->Result<NativeWebOriginal,String>{
 check(&state,&binding,&lease)?;
 let mut intake=state.live_agent.begin_local_web_intake(&lease,&||check_saved(&state,&binding,lease.session_id()))?;
 // Reservation exists before polling data. The framework's transport buffers
 // remain a separate required HTTP budget; no to_bytes/collect/to_vec/JSON AST.
 let mut frames=body.into_data_stream();
 while let Some(frame)=frames.next().await{
  check(&state,&binding,&lease)?;
  match frame{Ok(frame)=>intake.append_frame(frame.as_ref())?,Err(_)=>{intake.received_failure();return Err("Actual private request read failed".into())}}
 }
 intake.received_eof()?;
 capture(&state,&binding,&lease,method,target,headers,intake)
}

// Missing outer function in current Native: no actual implementation of
// desktop NativeAuthLease/OriginalWebAuthority creates/mounts a service private
// proxy handler calling acquire -> receive_prompt -> submit_prompt. Root must
// bind this concrete consumer under its actual child/origin/profile lifecycle.
// It is intentionally not exposed on the ordinary authenticated public router.
