# Rebase ONLY the explicit startup follow-on operations onto current Root source.
# Reads Native; emits a review JSON beside this file; never applies or compiles.
$ErrorActionPreference='Stop'
$nativeRoot='\\wsl.localhost\Ubuntu\home\brajam\.local\state\ingenium-release\skill-zen-fix-1792810845\real-gmail-ui\veyra-phase-1\windows-source'
$utf8=[Text.UTF8Encoding]::new($false)
function Hash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($s))).ToLowerInvariant()}
$proposal=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proposal.json') -Raw|ConvertFrom-Json
$selectors=@(
 @('apps/service/src/routes/idle_engine.rs','pub(in crate::routes) struct IdleEngineRetirement {'),
 @('apps/service/src/routes/tasks/retained.rs','mod idle_retirement;'),
 @('apps/service/src/routes/provider.rs','    pub(in crate::routes) fn preflight_retained_startup('),
 @('apps/service/src/routes/provider.rs','    pub(super) fn publish_initial('),
 @('apps/service/src/routes/provider.rs','        self.preflight_retained_startup(originals, Some(original), observed.deadline())?;'),
 @('apps/service/src/routes/task_submission/root_engine.rs','        if !tasks.is_empty() {'),
 @('apps/service/src/routes/task_submission/root_engine.rs','    if active.is_none() {'),
 @('apps/service/src/routes/tasks/initial.rs','    current.preflight_retained_startup('),
 @('apps/service/src/routes/tasks/initial.rs','            provider.preflight_retained_startup(&originals, None, deadline)?;'),
 @('apps/service/src/routes/tasks/initial.rs','            let result = provider.publish_initial(&originals, &candidate, observed);')
)
$ops=[Collections.Generic.List[object]]::new()
foreach($selector in $selectors){
 $matches=@($proposal.operations|Where-Object {$_.path-eq$selector[0]-and$_.find.StartsWith($selector[1],[StringComparison]::Ordinal)})
 if($matches.Count-ne1){throw "Canonical startup operation is ambiguous: $($selector[0])"}
 $op=$matches[0];$blob=[IO.File]::ReadAllText((Join-Path $nativeRoot $op.path))
 if($blob.Contains([char]13)-or([regex]::Matches($blob,[regex]::Escape($op.find))).Count-ne1){throw "Current exact startup preimage changed: $($op.path)"}
 $ops.Add([ordered]@{path=$op.path;preimage_sha256=(Hash $blob);find=$op.find;replacement=$op.replacement})
}
foreach($path in ($ops.path|Select-Object -Unique)){
 $post=[IO.File]::ReadAllText((Join-Path $nativeRoot $path))
 foreach($op in ($ops|Where-Object path -eq $path)){
  if(([regex]::Matches($post,[regex]::Escape($op.find))).Count-ne1){throw "Combined startup preimage changed: $path"}
  $post=$post.Replace($op.find,$op.replacement)
 }
}
$rows=[Collections.Generic.List[object]]::new()
foreach($target in @('apps/service/src/routes/idle_engine/startup_queue.rs','apps/service/src/routes/tasks/retained/startup_queue.rs')){
 if(Test-Path -LiteralPath (Join-Path $nativeRoot $target)){throw "Startup source target already exists: $target"}
 $source='sources/'+$target;$data=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $source))
 $rows.Add([ordered]@{source=$source;target=$target;required_preimage='absent';bytes=$data.Length;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($data)).ToLowerInvariant()})
}
$result=[ordered]@{
 status='unapplied-uncompiled-startup-source-follow-on';depends_on='d1bcb3c7f7333e4932a955b7fcde1628fe52a868';
 new_authored_cases=6;worker_executed_rust=0;operations=$ops;sources=$rows;
 proof='real service reference + borrowed original slots + sealed completed idle-engine/activity/task-store reads; same queue/acquisition/native/journal eligibility';
 preservation='no public ctor/Clone/Deserialize/DTO/boolean proof; no ownership deletion; legacy pristine compatibility unchanged';
 plan='native-startup-qualification-plan.md';
}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'startup-delta.json'),($result|ConvertTo-Json -Depth 10).Replace([string][char]13,''),$utf8)
"Verified $($ops.Count) exact current Root startup preimages and $($rows.Count) absent targets; no Native writes."
