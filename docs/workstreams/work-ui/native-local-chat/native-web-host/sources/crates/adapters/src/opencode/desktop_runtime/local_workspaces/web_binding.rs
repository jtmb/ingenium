//! Proposed Root-owned producer integration. Not mounted or compiled by Work UI.
//! This observation is NOT a Web capability and never exposes engine auth/URL.
use super::*;
use veyra_contracts::local_workspaces::LocalWorkspaceOwner;

#[derive(Clone, PartialEq)]
pub(in crate::opencode::desktop_runtime) struct LocalWebRuntimeObservation {
    pub owner: LocalWorkspaceOwner,
    pub session_id: String,
    pub directory: String,
    pub engine_project_id: String,
    pub engine_instance_id: String,
    pub engine_revision: u64,
    pub engine_pid: u32,
    pub upstream_version: String,
}

impl LiveRuntime {
    /// Caller first uses original current registry + require_local_session.
    /// Call again before/after each bound proxy read/effect; compare the entire
    /// observation. A retained observation alone never authorizes later I/O.
    pub(in crate::opencode::desktop_runtime) fn local_web_runtime_observation(
        &self,
        binding: &LocalWorkspaceBinding,
        session_id: &str,
        current: &dyn Fn() -> Result<(), String>,
    ) -> Result<LocalWebRuntimeObservation, RuntimeError> {
        let engine = self.lock_engine_for_directory(binding.directory())?;
        require_local_engine(&engine, binding, current)?;
        let revision = self.credentials_revision();
        let instance = task_permissions::current_engine_instance_id(&engine)?;
        let session = engine.client()?.session_in_project(session_id, &SessionQuery {
            directory: binding.directory().into(), ..SessionQuery::default()
        })?;
        require_local_engine(&engine, binding, current)?;
        let info = engine.client()?.info()?;
        if session.id != session_id || session.location.directory != binding.directory()
            || session.project_id.is_empty() || info.version != PINNED_VERSION
            || engine.registration_pid != Some(info.pid)
            || task_permissions::current_engine_instance_id(&engine)? != instance
            || self.credentials_revision() != revision
        { return Err(local_error()); }
        require_local_engine(&engine, binding, current)?;
        Ok(LocalWebRuntimeObservation {
            owner: binding.owner().clone(), session_id: session.id,
            directory: session.location.directory, engine_project_id: session.project_id,
            engine_instance_id: instance, engine_revision: revision,
            engine_pid: info.pid, upstream_version: info.version,
        })
    }
}
