"""Owned same-file follow-on; no Native writes/compilation/runtime."""
import difflib,hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parent
path='apps/desktop/src-tauri/src/hosted_windows.rs'
old=(root/'hosted_windows.rs').read_bytes()
pins=json.loads((root/'inputs.json').read_text())
assert hashlib.sha256(old).hexdigest()==pins[path]['proposed_sha256']
new=(root/'hosted_windows_destroyed_806a.rs').read_bytes()
patch=''.join(difflib.unified_diff(old.decode().splitlines(True),new.decode().splitlines(True),fromfile='a/'+path,tofile='b/'+path,n=0)).encode()
(root/'hosted_windows_destroyed_806a.patch').write_bytes(patch)
text=new.decode();callback=text[text.index('created.on_window_event'):text.index('  let mut originals=self.originals.lock()',text.index('created.on_window_event'))]
checks={
 'exact_806a_preimage_preserved':True,
 'same_native_file_only':patch.count(b'+++ b/')==1,
 'registry_arc_owned':'originals:Arc<Mutex<HashMap<String,Arc<WindowOriginal>>>>'in text,
 'actual_destroyed_guard':'if !matches!(event,WindowEvent::Destroyed){return}'in callback,
 'fence_before_index_removal':callback.index('original.fence()')<callback.index('entries.remove(&label)'),
 'exact_same_arc_and_uid_required':'Arc::ptr_eq(current,&original)&&current.uid()==uid'in callback,
 'weak_callback_owners_no_registry_cycle':'Arc::downgrade(&original)'in text and'Arc::downgrade(&self.originals)'in text,
 'registration_precedes_insertion':text.index('created.on_window_event')<text.index('originals.insert('),
 'no_registry_lock_across_callback_registration':text.index('created.on_window_event')<text.index('  let mut originals=self.originals.lock()'),
 'observed_destroyed_written_only_in_native_callback':text.count('destroyed.store(')==1 and'destroyed.store(true'in callback,
 'destroyed_during_enrollment_not_inserted':text.index('original.destroyed.load(')<text.index('originals.insert('),
 'live_label_still_refused':'if originals.contains_key(original.root.label()){return Err('in text,
 'requester_fence_and_origin_guards_preserved':'self.fenced.load(Ordering::Acquire)'in text and'!crate::ipc_origin::accepts(&self.root)'in text,
 'no_close_drop_or_retirement_in_destroyed_callback':all(x not in callback for x in ['.close(','.retire(','.release(','.take(', 'drop(']),
 'no_broker_package_or_control_factory_changed':all(x not in text for x in ['impl OriginalWebAuthority','impl NativeAuthLease','LocalReleaseTrustRecord']),
}
assert all(checks.values()),checks
result={'scope':'finite source review predicates only; actual Rust/native lifecycle unqualified','path':path,'preimage_sha256':hashlib.sha256(old).hexdigest(),'proposed_sha256':hashlib.sha256(new).hexdigest(),'patch_bytes':len(patch),'patch_sha256':hashlib.sha256(patch).hexdigest(),'checks':checks,'passed':sum(checks.values()),'compiler_runtime_or_cu_run':False,'shared_source_or_dependency_changes':False,'full_goal_complete':False}
(root/'hosted_windows_destroyed_806a.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':result['passed'],'preimage_sha256':result['preimage_sha256'],'proposed_sha256':result['proposed_sha256'],'patch_bytes':len(patch),'patch_sha256':result['patch_sha256']}))
