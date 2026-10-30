# Native proposal verifier; never applies to Native.
param([switch]$VerifyOnly)
$ErrorActionPreference='Stop'
$nativeGit='C:/Users/james/OneDrive/Documents/ChatGPT/local-models-setup/.git'
$revision='4e8e29436cfe42c81cc6401599cf8d224357a928'
$utf8=[Text.UTF8Encoding]::new($false)
function Hash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($s))).ToLowerInvariant()}
function ReadPinned([string]$path){
 $p=[Diagnostics.ProcessStartInfo]::new('git');$p.UseShellExecute=$false;$p.RedirectStandardOutput=$true;$p.RedirectStandardError=$true
 $p.ArgumentList.Add("--git-dir=$nativeGit");$p.ArgumentList.Add('show');$p.ArgumentList.Add($revision+':'+$path)
 $child=[Diagnostics.Process]::Start($p);$text=$child.StandardOutput.ReadToEnd();$err=$child.StandardError.ReadToEnd();$child.WaitForExit()
 if($child.ExitCode-ne0){throw $err};return $text
}
$ops=[Collections.Generic.List[object]]::new()
function ReplaceOnce([string]$path,[string]$find,[string]$replacement){
 $find=$find.Replace([string][char]13,'');$replacement=$replacement.Replace([string][char]13,'')
 $blob=ReadPinned $path
 if($blob.Contains([char]13)){throw "Pinned source must have LF bytes: $path"}
 if(([regex]::Matches($blob,[regex]::Escape($find))).Count-ne1){throw "Exact preimage not unique: $path / $find"}
 $ops.Add([ordered]@{path=$path;preimage_sha256=(Hash $blob);find=$find;replacement=$replacement})
}
ReplaceOnce 'Cargo.toml' '"crates/wsl-owner-helper"]' '"crates/wsl-owner-helper", "crates/veyra-memory"]'
ReplaceOnce 'Cargo.toml' 'veyra-harness = { path = "crates/harness" }' ('veyra-harness = { path = "crates/harness" }'+[char]10+'veyra-memory = { path = "crates/veyra-memory" }')
foreach($p in @('crates/adapters/Cargo.toml','apps/service/Cargo.toml')){
 ReplaceOnce $p 'veyra-contracts.workspace = true' ('veyra-contracts.workspace = true'+[char]10+'veyra-memory.workspace = true')
}
ReplaceOnce 'crates/adapters/src/lib.rs' 'pub mod goal_store;' ('pub mod goal_store;'+[char]10+'pub mod native_memory_owner;')
ReplaceOnce 'crates/adapters/src/goal_store.rs' 'mod retained_workspaces;' ('mod retained_workspaces;'+[char]10+'mod learned;')
ReplaceOnce 'crates/adapters/src/goal_store.rs' '    uncertain: bool,' ('    learned: veyra_memory::LearnedState,'+[char]10+'    uncertain: bool,')
ReplaceOnce 'crates/adapters/src/goal_store.rs' '        Ok(Self { path, db, retained_tasks, retained_forks, retained_workspaces, uncertain: false })' ('        let learned = learned::load(directory)?;'+[char]10+'        Ok(Self { path, db, retained_tasks, retained_forks, retained_workspaces, learned, uncertain: false })')
ReplaceOnce 'crates/adapters/src/goal_store.rs' '        value["retained_task_goals"]' ('        value["learned_memory_v1"] = serde_json::to_value(&self.learned).map_err(|_|"Learned memory export failed")?;'+[char]10+'        value["retained_task_goals"]')
ReplaceOnce 'crates/adapters/src/opencode/desktop_runtime.rs' 'mod prompt_original;' ('mod prompt_original;'+[char]10+'mod memory;')
ReplaceOnce 'crates/contracts/src/lib.rs' 'pub use prompt_originals::*;' ('pub use prompt_originals::*;'+[char]10+'mod local_prompt_original;'+[char]10+'pub use local_prompt_original::*;')
$record=@'
struct PromptRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    original: Option<veyra_contracts::PromptOriginal>,
'@
ReplaceOnce 'crates/adapters/src/opencode/desktop_runtime.rs' $record ($record+[char]10+'    #[serde(default, skip_serializing_if = "Option::is_none")]'+[char]10+'    local_original: Option<veyra_contracts::LocalPromptOriginal>,')
$recordCapture=@'
        let record = PromptRecord {
            original: original.cloned(),
'@
$recordCaptureNew=@'
        // Requires the already-composed Projects8b local owner parameter.
        // Old retained records return above; no backfill or fresh recapture.
        if local.is_some() && original.is_some(){return Err(RuntimeError::Binding)}
        let local_original=match local{
            Some((binding,current))=>Some(memory::local_original::capture(
                self,&engine,binding,current,&before,request_id,text,files,skill_ids,require_idle)?),
            None=>None,
        };
        let record = PromptRecord {
            original: original.cloned(),
            local_original,
'@
ReplaceOnce 'crates/adapters/src/opencode/desktop_runtime.rs' $recordCapture $recordCaptureNew
ReplaceOnce 'apps/service/src/routes.rs' 'mod provider;' ('mod provider;'+[char]10+'pub(crate) use provider::memory_admission::MemorySynthesisAdmission;')
ReplaceOnce 'apps/service/src/routes/provider.rs' 'mod queue;' ('mod queue;'+[char]10+'pub(super) mod memory_admission;'+[char]10+'pub(super) mod memory_synthesis;')
ReplaceOnce 'apps/service/src/inference/mod.rs' 'mod request;' ('mod request;'+[char]10+'pub(crate) mod request_purpose;')
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' 'use super::{' ('mod memory;'+[char]10+'pub(crate) use memory::QueuedMemory;'+[char]10+'use super::{')
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' ('struct Book {'+[char]10+'    entries: Vec<Arc<QueuedProvider>>,') ('struct Book {'+[char]10+'    entries: Vec<Arc<QueuedProvider>>,'+[char]10+'    memory: memory::MemoryBook,')
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' '        if book.entries.len() >= 128 {' '        if book.entries.len() + book.memory.entries.len() >= 128 {'
$memoryReplay=@'
        if book.memory.unknown()?{return Err(GatewayError::RuntimeUnavailable)}
        if payload.call_id().is_some_and(|id|book.memory.entries.iter().any(|e|e.admission.original().operation_id==id)){
            return Err(GatewayError::Conflict)
        }
'@
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' '        let retained_bytes = book' ($memoryReplay+[char]10+'        let retained_bytes = book')
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' '        if book.dispatching.is_some() {' ('        if book.memory.unknown()?{return Err(GatewayError::RuntimeUnavailable)}'+[char]10+'        if book.dispatching.is_some() || book.memory.reserved.is_some() || book.memory.earlier_waiting(entry.id)? {')
$dispatch=@'
        Ok(book
            .dispatching
            .map(|id| book.entries[id].grant.turn_id.clone()))
'@
$dispatchNew=@'
        if let Some(id)=book.memory.reserved{return Ok(Some(book.memory.entries[id].admission.original().operation_id.clone()))}
        Ok(book
            .dispatching
            .map(|id| book.entries[id].grant.turn_id.clone()))
'@
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' $dispatch $dispatchNew
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' '        // Called without an entry guard.' ('        if book.memory.unknown()?{return Err(GatewayError::RuntimeUnavailable)}'+[char]10+'        // Called without an entry guard.')
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' '        for prior in &book.entries[..entry.id] {' ('        if book.memory.unknown()?{return Err(GatewayError::RuntimeUnavailable)}'+[char]10+'        if book.memory.earlier_waiting(entry.id)?{return Ok(false)}'+[char]10+'        for prior in &book.entries[..entry.id] {')
ReplaceOnce 'apps/service/src/inference/provider_queue.rs' '        Ok(!book.entries.is_empty() || !book.closed_tasks.is_empty())' '        Ok(!book.entries.is_empty() || !book.memory.entries.is_empty() || !book.closed_tasks.is_empty())'
ReplaceOnce 'crates/adapters/src/provider_attempts.rs' 'mod types;' ('mod types;'+[char]10+'mod memory;'+[char]10+'pub use memory::{MemoryAttemptMetadata,MemoryAttemptYielded};')
ReplaceOnce 'crates/adapters/src/provider_attempts.rs' '            n if n > 2 => return Err(ProviderAttemptStoreError::NewerSchema),' ('            3 => validate_database(&tx)?,'+[char]10+'            n if n > 3 => return Err(ProviderAttemptStoreError::NewerSchema),')
$beforeCommit=@'
        validate_database(&tx)?;
        tx.commit()?;
'@
$beforeCommitNew=@'
        let version:i64=tx.pragma_query_value(None,"user_version",|r|r.get(0))?;
        if version==2{tx.execute_batch(include_str!("provider_attempts/0003.sql"))?;}
        validate_database(&tx)?;
        tx.commit()?;
'@
ReplaceOnce 'crates/adapters/src/provider_attempts.rs' $beforeCommit $beforeCommitNew
ReplaceOnce 'crates/adapters/src/provider_attempts.rs' '        1 | 2 => validate_database(connection),' '        1 | 2 | 3 => validate_database(connection),'
ReplaceOnce 'crates/adapters/src/provider_attempts.rs' '        n if n > 2 => Err(ProviderAttemptStoreError::NewerSchema),' '        n if n > 3 => Err(ProviderAttemptStoreError::NewerSchema),'
ReplaceOnce 'crates/adapters/src/provider_attempts/validation.rs' '    if version > 2 {' ('    if version==3{return super::memory::validate_schema_v3(connection);}'+[char]10+'    if version > 3 {')
$databaseEnd=@'
            decode_row(row)?;
        }
    }
    Ok(())
'@
$databaseEndNew=@'
            decode_row(row)?;
        }
    }
    if version==3{super::memory::validate_rows(connection)?;}
    Ok(())
'@
ReplaceOnce 'crates/adapters/src/provider_attempts/validation.rs' $databaseEnd $databaseEndNew
# Unconditional child extends SAME journal, not the cfg(test) source carrier.
ReplaceOnce 'apps/service/src/routes/provider/journal.rs' 'use crate::inference::GatewayError;' ('mod memory;'+[char]10+'use crate::inference::GatewayError;')
$startup=@'
                let startup = match store.pending(None, 1) {
                    Ok(records) if records.is_empty() => Ok(()),
                    Ok(_) => Err(GatewayError::RequestBusy),
                    Err(_) => Err(GatewayError::RuntimeUnavailable),
                };
'@
$startupNew=@'
                let startup = match (store.pending(None, 1),store.pending_memory()) {
                    (Ok(records),Ok(false)) if records.is_empty() => Ok(()),
                    (Ok(_),Ok(_)) => Err(GatewayError::RequestBusy),
                    _ => Err(GatewayError::RuntimeUnavailable),
                };
'@
ReplaceOnce 'apps/service/src/routes/provider/journal.rs' $startup $startupNew
# Projects owns the ONE canonical scoped bounded-recent client extension.
# Do not add a memory-specific OpenCodeClient implementation here.
ReplaceOnce 'apps/service/src/routes/goal_runtime.rs' 'mod controls;' ('mod controls;'+[char]10+'mod learned;')
ReplaceOnce 'apps/service/src/routes/goal_runtime.rs' '    entries: Vec<SavedMemory>,' '    pub(in crate::routes) entries: Vec<SavedMemory>,'
ReplaceOnce 'apps/service/src/routes/goal_runtime.rs' '    goal_memory_ids: Option<Vec<String>>,' ('    pub(in crate::routes) goal_memory_ids: Option<Vec<String>>,'+[char]10+'    #[serde(default, skip_serializing_if = "Option::is_none")]'+[char]10+'    learned: Option<learned::LearnedAdmission>,')
ReplaceOnce 'apps/service/src/routes/goal_runtime.rs' '        Ok(MemoryAdmission { entries, goal_memory_ids: None })' '        Ok(MemoryAdmission { entries, goal_memory_ids: None, learned: None })'
ReplaceOnce 'apps/service/src/routes/goal_runtime.rs' '            goal_memory_ids: Some(goal.selected_memory_ids),' ('            goal_memory_ids: Some(goal.selected_memory_ids),'+[char]10+'            learned: None,')
$compose=@'
            prompt.push_str(&block);
        }
        Ok(prompt)
'@
$composed=@'
            prompt.push_str(&block);
        }
        if let Some(learned)=&self.learned{learned.compose(&mut prompt,&mut bytes)?;}
        Ok(prompt)
'@
ReplaceOnce 'apps/service/src/routes/goal_runtime.rs' $compose $composed
$validate='        Self::validate_memory(guard.as_ref().ok_or("Memory store is unavailable")?, project, session, memory)?;'
ReplaceOnce 'apps/service/src/routes/goal_runtime.rs' $validate ($validate+[char]10+'        if memory.learned.is_some(){return Err("Learned originals require the Native owner boundary".into());}')
ReplaceOnce 'apps/service/src/routes/goal_runtime.rs' '        .merge(controls::router())' ('        .merge(controls::router())'+[char]10+'        .merge(learned::router())')
$preview=@'
        let memory = if input.memory_selection.is_empty() {
            None
        } else {
            Some(
                state
                    .goals
                    .capture_memory(&project.id, &id, &input.memory_selection)
                    .map_err(|_| binding())?,
            )
        };
'@
$previewNew=@'
        let native_owner=veyra_adapters::native_memory_owner::NativeMemoryOwner::project(
            projects.as_ref().ok_or(RuntimeError::Storage)?,&project,&state.instance_id).map_err(|_|binding())?;
        let captured_memory=state.goals.capture_native_memory(
            projects.as_ref().ok_or(RuntimeError::Storage)?,&native_owner,&state.live_agent.runtime,
            &project.id,&id,&input.memory_selection).map_err(|_|binding())?;
        let memory=captured_memory.has_retained_context().then_some(captured_memory);
'@
ReplaceOnce 'apps/service/src/routes/live_agent/main_prompt.rs' $preview $previewNew
$submit=@'
            if json!(current_memory) != original.memory {
                return Err(binding());
            }
'@
$submitNew=@'
            // Learned context is validated from the retained original at final
            // admission, never recaptured. Explicit selection remains exact.
            let retained:Option<MemoryAdmission>=serde_json::from_value(original.memory.clone()).map_err(|_|binding())?;
            if let Some(retained)=&retained {
                let current_entries=current_memory.as_ref().map(|m|m.entries.as_slice()).unwrap_or(&[]);
                if retained.goal_memory_ids.is_some() || current_entries!=retained.entries.as_slice(){return Err(binding())}
            } else if current_memory.is_some(){return Err(binding())}
'@
ReplaceOnce 'apps/service/src/routes/live_agent/main_prompt.rs' $submit $submitNew
$guarded='            return state.goals.with_memory(&project.id, session, memory, || {'
$guardedNew=@'
            let native_owner=veyra_adapters::native_memory_owner::NativeMemoryOwner::project(
                projects.as_ref().ok_or(RuntimeError::Storage)?,&current,&state.instance_id).map_err(|_|RuntimeError::Binding)?;
            return state.goals.with_native_memory(projects.as_ref().ok_or(RuntimeError::Storage)?,
                &native_owner,&state.live_agent.runtime,&project.id, session, memory, || {
'@
ReplaceOnce 'apps/service/src/routes/live_agent/lifecycle.rs' $guarded $guardedNew
$custody=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'prompt-custody.append.ts') -Raw
ReplaceOnce 'apps/web/src/features/workbench/promptOriginal.ts' 'export function exportPromptOriginals(' ($custody+[char]10+'export function exportPromptOriginals(')
ReplaceOnce 'apps/web/src/features/workbench/Workbench.tsx' 'import { MemoryPanel } from "./MemoryPanel";' ('import { MemoryPanel } from "./MemoryPanel";'+[char]10+'import { LearnedMemoryControls } from "./native-memory/LearnedMemoryControls";')
ReplaceOnce 'apps/web/src/features/workbench/Workbench.tsx' '            <MemoryPanel ' ('            <LearnedMemoryControls request={call} project={project} sessionId={activeSessionId} disabled={busy || !connected || !!pendingPrompt || !!pendingFork || !!pendingSession}/>' +[char]10+'            <MemoryPanel ')
$manifest=[ordered]@{native_revision=$revision;projects_proposal='8b18318e248c7e1cba953c1e68b47529aac1a276';status='unapplied-uncompiled-source-proposal';required_reconciliation=@{
 owner='Root/Projects';status='bound-in-source-awaiting-Native-integration-review';actual_export='OpenCodeClient::local_recent_messages(id, cursor, limit) -> MessagePage';
 provider_source='docs/workstreams/projects/native-local-v6/sources/crates/adapters/src/opencode/local_conversations.rs';
 provider_source_sha256='af67f2348b579571145e5add34ab6134b8a2edc129f54712ef313ad3fd535215';
 route_contract='docs/workstreams/projects/native-local-v6/local-route-contract.json';
 route_contract_sha256='cdacba40b95131ea9d4a5e7229cb31874d13d12bc2d6f723710df85d670dfe5f';
 consumer='crates/adapters/src/opencode/desktop_runtime/memory.rs:LiveRuntime::memory_recent';
 superseded='eddbd5f2 OpenCodeClient::memory_recent insertion; do not apply';
 contract='ONE scoped latest page <=32; descending first; cursor-only next owned by Projects; memory never follows cursor; canonical conversion; reject overfill; chronological selected output';
 authority='Actual held ProjectStore owner; private verify_current and shared require_local_engine closure before/after reads; decoder grants no authority';
 local_original_contract='Additive LocalPromptOriginal and optional PromptRecord.local_original capture under original prompt writer; requires Projects8b prompt_scoped_checked_local composition; no fake Project or legacy backfill';
 local_original_gate='Root must reconcile all PromptRecord fixture constructors, version/rollback writer preservation and original receipt/lookup publication before runtime acceptance';
 memory_purpose=@{
  status='closed contract/factory/queue/journal source only; original native producers unsupported; NOT connected generation';
  owner='SAME provider registry/request slot/queue Book/retained workers/ModelWork/TransportSupervisor/attempt journal/Core leases';
  native_engine_changes='none; backend authenticates actual runtime launch/binding/request UUID, not service TaskStore IDs';
  ingress='internal MemorySynthesis only; no public/general prompt or utility HTTP route';
  unsupported=@('registry Memory candidate/final slot claim','acquisition Memory originals without Task grants','matching retained result/native retirement and lease yield','original productivity two-phase invocation after real producer is installed');
  audit='closed-synthesis-purpose.md';
 };
 apply_gate='Root must compose Projects owner/module wiring and review/compile the combined Native proposal; source binding does not establish runtime acceptance';
};operations=$ops}
foreach($path in ($ops.path|Select-Object -Unique)){
 $post=ReadPinned $path
 foreach($op in ($ops|Where-Object path -eq $path)){
  if(([regex]::Matches($post,[regex]::Escape($op.find))).Count-ne1){throw "Combined operation preimage changed: $path"}
  $post=$post.Replace($op.find,$op.replacement)
 }
}
if(!$VerifyOnly){
 [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'proposal.json'),($manifest|ConvertTo-Json -Depth 12).Replace([string][char]13,''),$utf8)
 $sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
 $rows=[Collections.Generic.List[object]]::new()
 function AddSource($source,$target,$transform){
  $data=[IO.File]::ReadAllBytes((Join-Path $sourceRoot $source))
  $rows.Add([ordered]@{source=$source.Replace('\','/');target=$target.Replace('\','/');required_preimage='absent';
    sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($data)).ToLowerInvariant();bytes=$data.Length;transform=$transform})
 }
 foreach($file in Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'crates/veyra-memory') -File -Recurse){
  $relative=[IO.Path]::GetRelativePath($sourceRoot,$file.FullName);AddSource $relative $relative $null
 }
 $addons=Join-Path $PSScriptRoot 'sources'
 foreach($file in Get-ChildItem -LiteralPath $addons -File -Recurse){
  AddSource ([IO.Path]::GetRelativePath($sourceRoot,$file.FullName)) ([IO.Path]::GetRelativePath($addons,$file.FullName)) $null
 }
 $ui='services/ingenium-dashboard/src/app/components/memory-v2'
 AddSource "$ui/controller.mjs" 'apps/web/src/features/workbench/memoryController.mjs' $null
 AddSource "$ui/native/adapter.mjs" 'apps/web/src/features/workbench/native-memory/adapter.mjs' @{find='../controller.mjs';replacement='../memoryController.mjs'}
 AddSource "$ui/native/adapter.d.mts" 'apps/web/src/features/workbench/native-memory/adapter.d.mts' $null
 AddSource "$ui/native/LearnedMemoryControls.tsx" 'apps/web/src/features/workbench/native-memory/LearnedMemoryControls.tsx' $null
 [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'sources.json'),($rows|ConvertTo-Json -Depth 6).Replace([string][char]13,''),$utf8)
}
"Verified $($ops.Count) exact preimages against $revision; no Native writes."
