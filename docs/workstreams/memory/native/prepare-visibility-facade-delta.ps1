# Read current Root Native source only; write the minimal review delta here.
# Never applies to Native or starts a compiler/runtime.
$ErrorActionPreference='Stop'
$nativeRoot='\\wsl.localhost\Ubuntu\home\brajam\.local\state\ingenium-release\skill-zen-fix-1792810845\real-gmail-ui\veyra-phase-1\windows-source'
$utf8=[Text.UTF8Encoding]::new($false)
function Hash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($s))).ToLowerInvariant()}
$ops=[Collections.Generic.List[object]]::new()
function AddOp([string]$path,[string]$find,[string]$replacement){
 $source=[IO.File]::ReadAllText((Join-Path $nativeRoot $path))
 if($source.Contains([char]13)){throw "Expected LF Native source: $path"}
 if(([regex]::Matches($source,[regex]::Escape($find))).Count-ne1){throw "Current exact preimage not unique: $path / $find"}
 $ops.Add([ordered]@{path=$path;preimage_sha256=(Hash $source);find=$find;replacement=$replacement})
}
AddOp 'apps/service/src/inference/mod.rs' 'pub use registry::{GatewayRegistry, SessionGrant};' ('pub use registry::{GatewayRegistry, SessionGrant};'+[char]10+'pub(crate) use registry::memory::{MemoryCandidate,MemoryClaim,MemorySlotReleased};')
AddOp 'apps/service/src/routes/live_agent.rs' 'mod main_prompt;' ('mod main_prompt;'+[char]10+'mod memory_learning;')
$admission='apps/service/src/routes/provider/memory_admission.rs'
AddOp $admission 'state.goals.capture_learning(store,&owner,&state.live_agent.runtime,chat,now)' 'state.live_agent.capture_learning(&state.goals,store,&owner,chat,now)'
AddOp $admission 'state.live_agent.runtime.memory_synthesis_model(store,&owner,chat)' 'state.live_agent.memory_synthesis_model(store,&owner,chat)'
AddOp $admission 'state.live_agent.runtime.memory_synthesis_model(store,&self.owner,&original.snapshot.chat_id)' 'state.live_agent.memory_synthesis_model(store,&self.owner,&original.snapshot.chat_id)'
AddOp $admission 'state.goals.verify_learning(store,&self.owner,&state.live_agent.runtime,&original.snapshot)' 'state.live_agent.verify_learning(&state.goals,store,&self.owner,&original.snapshot)'
AddOp $admission 'state.goals.accept_learning(store,&self.owner,&state.live_agent.runtime,&original.snapshot,&original.operation_id,entry)' 'state.live_agent.accept_learning(&state.goals,store,&self.owner,&original.snapshot,&original.operation_id,entry)'
AddOp 'apps/service/src/routes/provider/acquisition/memory.rs' 'registry::memory::{MemoryCandidate,MemoryClaim,MemorySlotReleased},' 'MemoryCandidate,MemoryClaim,MemorySlotReleased,'
AddOp 'apps/service/src/routes/provider/memory_synthesis.rs' 'registry::memory::MemorySlotReleased' 'MemorySlotReleased'
AddOp 'apps/service/src/inference/owned_transport/purpose.rs' 'use crate::inference::registry::memory::{MemoryCandidate,MemoryClaim};' 'use crate::inference::{MemoryCandidate,MemoryClaim};'
AddOp 'apps/service/src/inference/provider_queue/memory.rs' '&crate::inference::registry::memory::MemorySlotReleased' '&crate::inference::MemorySlotReleased'
foreach($path in ($ops.path|Select-Object -Unique)){
 $post=[IO.File]::ReadAllText((Join-Path $nativeRoot $path))
 foreach($op in ($ops|Where-Object path -eq $path)){
  if(([regex]::Matches($post,[regex]::Escape($op.find))).Count-ne1){throw "Combined delta collision: $path"}
  $post=$post.Replace($op.find,$op.replacement)
 }
}
$target='apps/service/src/routes/live_agent/memory_learning.rs'
if(Test-Path -LiteralPath (Join-Path $nativeRoot $target)){throw "New facade target already exists: $target"}
$source='sources/'+$target
$data=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $source))
$result=[ordered]@{
 status='unapplied-uncompiled-current-Root-source-delta';native_root=$nativeRoot;
 preservation='registry and LiveAgent.runtime remain private; same original runtime/Goals/store/owner checks; no general getter/callback';
 exact_types_verified=@{
  goals_path='apps/service/src/routes/goal_runtime/learned.rs';
  goals_sha256=(Hash ([IO.File]::ReadAllText((Join-Path $nativeRoot 'apps/service/src/routes/goal_runtime/learned.rs'))));
  model_path='crates/adapters/src/opencode/desktop_runtime/memory.rs';
  model_sha256=(Hash ([IO.File]::ReadAllText((Join-Path $nativeRoot 'crates/adapters/src/opencode/desktop_runtime/memory.rs'))));
 };
 operations=$ops;
 sources=@([ordered]@{source=$source;target=$target;required_preimage='absent';bytes=$data.Length;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($data)).ToLowerInvariant()});
}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'visibility-facade-delta.json'),($result|ConvertTo-Json -Depth 10).Replace([string][char]13,''),$utf8)
"Verified $($ops.Count) current Native exact preimages and one absent facade; no Native writes."
