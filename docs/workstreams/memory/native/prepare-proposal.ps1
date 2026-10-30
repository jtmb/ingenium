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
        let memory=Some(state.goals.capture_native_memory(
            projects.as_ref().ok_or(RuntimeError::Storage)?,&native_owner,&state.live_agent.runtime,
            &project.id,&id,&input.memory_selection).map_err(|_|binding())?);
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
$manifest=[ordered]@{native_revision=$revision;projects_proposal='7250f55f92e6554c47b945a529fbbbe7de114c06';status='unapplied-uncompiled-source-proposal';required_reconciliation=@{
 owner='Root/Projects';status='pending-frozen-shared-contract';actual_export=$null;
 consumer='crates/adapters/src/opencode/desktop_runtime/memory.rs:LiveRuntime::memory_recent';
 superseded='eddbd5f2 OpenCodeClient::memory_recent insertion; do not apply';
 contract='ONE scoped latest page <=32; descending first; cursor-only next owned by Projects; memory never follows cursor; canonical conversion; reject overfill; chronological selected output';
 apply_gate='Root must replace provisional client call with actual frozen Projects export and verify scope/order/bounds before Native apply/build';
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
