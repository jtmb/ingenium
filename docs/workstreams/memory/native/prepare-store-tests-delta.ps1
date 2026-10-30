# Current Root Native source is READ ONLY. Only a scoped source/review delta
# is emitted beside this script. No compiler/runtime/fixture is started.
$ErrorActionPreference='Stop'
$nativeRoot='\\wsl.localhost\Ubuntu\home\brajam\.local\state\ingenium-release\skill-zen-fix-1792810845\real-gmail-ui\veyra-phase-1\windows-source'
$utf8=[Text.UTF8Encoding]::new($false)
function Hash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($s))).ToLowerInvariant()}
$ops=[Collections.Generic.List[object]]::new()
function AddOp([string]$path,[string]$find,[string]$replacement){
 $source=[IO.File]::ReadAllText((Join-Path $nativeRoot $path))
 if($source.Contains([char]13)){throw "Expected LF source: $path"}
 if(([regex]::Matches($source,[regex]::Escape($find))).Count-ne1){throw "Current test registration preimage not unique: $path"}
 $ops.Add([ordered]@{path=$path;preimage_sha256=(Hash $source);find=$find;replacement=$replacement})
}
AddOp 'crates/adapters/src/lib.rs' 'pub mod goal_store;' ('pub mod goal_store;'+[char]10+'#[cfg(test)]'+[char]10+'mod memory_test_fixture;')
$find='use veyra_memory::{LearnedState,MemoryError};'
AddOp 'crates/adapters/src/goal_store/learned.rs' $find ($find+[char]10+'#[cfg(test)]'+[char]10+'mod tests;')
$find='use serde::{Deserialize,Serialize};'
AddOp 'crates/adapters/src/provider_attempts/memory.rs' $find ($find+[char]10+'#[cfg(test)]'+[char]10+'mod persistence_tests;')
$find='use super::*;'+[char]10+'use veyra_adapters::'
AddOp 'apps/service/src/routes/provider/memory_admission.rs' $find ('use super::*;'+[char]10+'#[cfg(test)]'+[char]10+'mod refusal_tests;'+[char]10+'use veyra_adapters::')
AddOp 'apps/service/src/inference/provider_queue.rs' 'mod memory;' ('mod memory;'+[char]10+'mod cleanup;')
AddOp 'apps/service/src/routes/provider/acquisition.rs' 'pub(in crate::routes::provider) mod memory;' ('pub(in crate::routes::provider) mod memory;'+[char]10+'#[cfg(windows)]'+[char]10+'pub(super) mod queue_cleanup;')
AddOp 'apps/service/src/routes/provider.rs' 'mod queue;' ('mod queue;'+[char]10+'#[cfg(windows)]'+[char]10+'mod queue_cleanup;')
$find=@'
        self.registry.check_engine_census(&engines.iter().map(|ready| ready.epoch.clone()).collect::<Vec<_>>())?;
        if self.registry.active_request()?.is_some() || self.registry.provider_queue().has_retained()? {
            return Err(GatewayError::RequestBusy);
        }
'@
AddOp 'apps/service/src/routes/provider.rs' $find @'
        self.registry.check_engine_census(&engines.iter().map(|ready| ready.epoch.clone()).collect::<Vec<_>>())?;
        if self.registry.active_purpose_request()?.is_some() {
            return Err(GatewayError::RequestBusy);
        }
        self.check_queue_cleanup(state,rows,deadline)?;
'@
$find=@'
    pub(in crate::routes) fn detach_retired_engine(
        &mut self,
'@
AddOp 'apps/service/src/routes/provider.rs' $find ($find+[char]10+'        state: &ServiceState,'+[char]10+'        rows: &[veyra_adapters::task_store::StoredTask],')
$find=@'
        cleanup.check_retained_completion(ready, deadline).map_err(unavailable)?;
        if self.registry.active_request()?.is_some() || self.registry.provider_queue().has_retained()? {
            return Err(GatewayError::RequestBusy);
        }
'@
AddOp 'apps/service/src/routes/provider.rs' $find @'
        cleanup.check_retained_completion(ready, deadline).map_err(unavailable)?;
        if self.registry.active_purpose_request()?.is_some() {
            return Err(GatewayError::RequestBusy);
        }
        self.check_queue_cleanup(state,rows,deadline)?;
'@
AddOp 'apps/service/src/routes/idle_engine.rs' '            .detach_retired_engine(&self.ready, &self.cleanup, deadline)' '            .detach_retired_engine(state, &self.activity.rows(), &self.ready, &self.cleanup, deadline)'
AddOp 'apps/service/src/routes/provider.rs' '        if engines.is_empty() && self.shutdown_blocked()? { return Err(GatewayError::RequestBusy); }' @'
        // Queue/acquisition/native/journal ownership was matched above. Memory
        // history can remain without a saved-task engine; unmatched task-only
        // cancellation/tree owners still prohibit this empty-engine cleanup.
        if engines.is_empty() && (self.cancellation_owners.has_retained() || !self.model_trees.is_empty()) {
            return Err(GatewayError::RequestBusy);
        }
'@
foreach($path in ($ops.path|Select-Object -Unique)){
 $post=[IO.File]::ReadAllText((Join-Path $nativeRoot $path))
 foreach($op in ($ops|Where-Object path -eq $path)){
  if(([regex]::Matches($post,[regex]::Escape($op.find))).Count-ne1){throw "Combined delta preimage changed: $path"}
  $post=$post.Replace($op.find,$op.replacement)
 }
}
$rows=[Collections.Generic.List[object]]::new()
$replacements=[Collections.Generic.List[object]]::new()
# These two wholly-owned sources are byte-identical in actual Root and accepted
# 8ae797e6. Refuse changed Root source instead of overwriting a later edit.
foreach($row in @(
 @('apps/service/src/inference/provider_queue/memory.rs','9a5350d27ed2ad225c29274b13771f2d44c060dfef9bf55fc22bc5574a6efe94'),
 @('apps/service/src/routes/provider/acquisition/memory.rs','3da3ee4d2b2cf7cc2339591cf83bed115b91ef6601ff5ab9603adc45e1554b10')
)){
 $target=$row[0];$before=Hash ([IO.File]::ReadAllText((Join-Path $nativeRoot $target)))
 if($before-ne$row[1]){throw "Wholly-owned source changed in Root; preserve and reconcile: $target"}
 $source='sources/'+$target;$data=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $source))
 $replacements.Add([ordered]@{source=$source;target=$target;required_preimage_sha256=$before;bytes=$data.Length;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($data)).ToLowerInvariant()})
}
foreach($target in @('crates/adapters/src/memory_test_fixture.rs','crates/adapters/src/goal_store/learned/tests.rs','crates/adapters/src/provider_attempts/memory/persistence_tests.rs','apps/service/src/inference/provider_queue/memory/refusal_tests.rs','apps/service/src/routes/provider/memory_admission/refusal_tests.rs','apps/service/src/inference/provider_queue/cleanup.rs','apps/service/src/routes/provider/acquisition/queue_cleanup.rs','apps/service/src/routes/provider/queue_cleanup.rs')){
 if(Test-Path -LiteralPath (Join-Path $nativeRoot $target)){throw "Test target already exists: $target"}
 $source='sources/'+$target;$data=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $source))
 $rows.Add([ordered]@{source=$source;target=$target;required_preimage='absent';bytes=$data.Length;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($data)).ToLowerInvariant()})
}
$result=[ordered]@{
 status='unapplied-uncompiled-store-and-queue-source';owner='01a18935-0219-7cc0-88be-368fa7fa330c';
 authored_cases=25;production_behavior_changes='separate exact cleanup eligibility; Task Unknown fences Memory admission/native phases through weak same-queue owner; has_retained ownership census unchanged';fixture_plan='native-store-qualification-plan.md';
 operations=$ops;sources=$rows;owned_replacements=$replacements;
 acceptance='Root runs actual stores/refusals; positive Memory lifecycle/queue/retirement/shutdown remains OPEN';
}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'store-tests-delta.json'),($result|ConvertTo-Json -Depth 10).Replace([string][char]13,''),$utf8)
"Verified $($ops.Count) current Root preimages, $($rows.Count) absent targets and $($replacements.Count) unchanged-owned-source bases; no Native writes or fixtures."
