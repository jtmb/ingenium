"""Exact minimal hooks/source proposal against current integrated Native.
No Native writes, broker enrollment, listener bind, compiler or runtime.
"""
import argparse,difflib,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);a=p.parse_args();root=Path(__file__).resolve().parent
pins=json.loads((root/'inputs.json').read_text())if(root/'inputs.json').exists()else{}
before={};after={}
def load(path):
 raw=(a.native/path).read_bytes();assert b'\r'not in raw
 if path in pins:assert hashlib.sha256(raw).hexdigest()==pins[path]['preimage_sha256'],('Native preimage drift; retain proposal',path)
 before[path]=raw.decode();after[path]=before[path]
def change(path,old,new):
 if path not in after:load(path)
 assert after[path].count(old)==1,(path,old)
 after[path]=after[path].replace(old,new)
def module(path,text):
 if path not in after:load(path)
 lines=after[path].splitlines(True);index=0
 while index<len(lines)and(lines[index].startswith('//!')or not lines[index].strip()):index+=1
 lines.insert(index,text+'\n');after[path]=''.join(lines)
def add(path,source):
 assert not(a.native/path).exists(),path
 before[path]='';after[path]=(root/source).read_text()
desktop='apps/desktop/src-tauri/src/'
module(desktop+'main.rs','mod hosted_windows;')
change(desktop+'main.rs','.manage(workspace_windows::WorkspaceWindows::default())','.manage(workspace_windows::WorkspaceWindows::default())\n        .manage(hosted_windows::HostedWindows::default())')
change(desktop+'main.rs','.setup(|app| {','.setup(|app| {\n            if let Some(root)=app.get_webview_window("main"){\n                app.state::<hosted_windows::HostedWindows>().retain_created(root).map_err(std::io::Error::other)?;\n            }')
windows=desktop+'workspace_windows.rs'
change(windows,'        WebviewWindowBuilder::new(&app, label, WebviewUrl::App(path.into()))','        let created=WebviewWindowBuilder::new(&app, label, WebviewUrl::App(path.into()))')
change(windows,'            .build()\n            .map(|_| ())\n            .map_err(|_| "Could not open the workspace window.".to_string())','            .build().map_err(|_| "Could not open the workspace window.".to_string())?;\n        app.state::<crate::hosted_windows::HostedWindows>().retain_created(created)?;\n        Ok(())')
add(desktop+'hosted_windows.rs','hosted_windows.rs')
routes='apps/service/src/routes/'
change(routes+'local_workspaces.rs','mod web_original;','pub(crate) mod web_original;')
module(routes+'local_workspaces/web_original.rs','pub(crate) mod private_receiver;')
module('apps/service/src/routes.rs','pub(crate) use local_workspaces::web_original::private_receiver::PrivateMount as LocalWebPrivateMount;')
add(routes+'local_workspaces/web_original/private_receiver.rs','private_receiver.rs')
module('apps/service/src/server/original.rs','mod private_listener;')
add('apps/service/src/server/original/private_listener.rs','private_listener.rs')
module('crates/adapters/src/lib.rs','pub mod native_web_peer;')
add('crates/adapters/src/native_web_peer.rs','kernel_peer.rs')
after['crates/adapters/src/native_web_peer.rs']=after['crates/adapters/src/native_web_peer.rs'].replace('use std::io;','pub mod linux_pidfd;\nuse std::io;')
after['crates/adapters/src/native_web_peer.rs']=after['crates/adapters/src/native_web_peer.rs'].replace('pub(crate)','pub')
add('crates/adapters/src/native_web_peer/linux_pidfd.rs','linux_peer_pidfd.rs')
after['crates/adapters/src/native_web_peer/linux_pidfd.rs']=after['crates/adapters/src/native_web_peer/linux_pidfd.rs'].replace('pub(crate)','pub')
patch=[]
for path,text in after.items():
 text=''.join(line.rstrip(' \t\r\n')+'\n'for line in text.splitlines());after[path]=text
 patch.extend(difflib.unified_diff(before[path].splitlines(True),text.splitlines(True),fromfile='a/'+path if before[path]else'/dev/null',tofile='b/'+path,n=0))
data=''.join(patch).encode();(root/'integration.patch').write_bytes(data)
(root/'inputs.json').write_text(json.dumps({p:{'preimage_sha256':hashlib.sha256(before[p].encode()).hexdigest(),'proposed_sha256':hashlib.sha256(t.encode()).hexdigest()}for p,t in after.items()},indent=2)+'\n')
receiver=(root/'private_receiver.rs').read_text();listener=(root/'private_listener.rs').read_text();host=(root/'hosted_windows.rs').read_text();peer=(root/'kernel_peer.rs').read_text();pidfd=(root/'linux_peer_pidfd.rs').read_text()
checks={
 'twelve_exact_native_paths':len(after)==12,
 'actual_main_window_constructor_hook':'retain_created(root)'in after[desktop+'main.rs'],
 'actual_detached_constructor_hook':'retain_created(created)'in after[windows],
 'no_renderer_register_command':'#[tauri::command]'not in host,
 'actual_window_and_webview_retained':'root:Webview,parent:Window'in host,
 'destroyed_fences_not_retirement':'WindowEvent::Destroyed'in host and'original.fence()'in host,
 'existing_origin_guard_preserved':'ipc_origin::accepts'in after[desktop+'main.rs'],
 'scope_has_no_dto_factory':'Deserialize'not in receiver.replace('// No Deserialize/Default/public constructor.','')and'impl Default for Scope'not in receiver,
 'scoped_auth_and_current_before_body':receiver.index('exact_single(request.headers(),"authorization"')<receiver.index('request.into_body()')and receiver.index('scope.current()')<receiver.index('request.into_body()'),
 'actual_original_body_consumer':'super::scoped_intake::receive_prompt'in receiver,
 'actual_original_submission_consumer':'super::submit_prompt'in receiver,
 'no_public_bearer_or_collected_body':all(x not in receiver for x in ['bearer_auth(','.collect(','.to_vec(', 'Request<Vec']),
 'actual_listener_reused':'ListenerStartup::prepare'in listener and'Listener::new(raw)'in listener,
 'bind_result_retained_before_publication':listener.index('sink.set(original.clone())')<listener.index('Ok(original)'),
 'actual_io_book_reused':'connections::Book::new()'in listener and'connections::serve('in listener,
 'actual_bound_endpoint_precedes_serve_publication':listener.index('self.mount.bind_original_endpoint(address)')<listener.index('.publish(publish)'),
 'real_task_enrolled_before_publish':listener.index('*task=Some(worker)')<listener.index('.publish(publish)'),
 'checked_listener_retirement_and_join':'actual.retire_until(deadline).await?'in listener and'WorkerPhase::Joined'in listener,
 'no_drop_or_counter_closure':'impl Drop'not in listener+peer+pidfd,
 'specific_kernel_named_pipe_queries':'GetNamedPipeClientProcessId(pipe.as_raw_handle()'in peer and'GetNamedPipeServerProcessId(pipe.as_raw_handle()'in peer,
 'actual_kernel_uds_credentials':'stream.peer_cred()'in peer,
 'socket_bound_pidfd_not_numeric_reopen':'SO_PEERPIDFD,(&mut fd'in pidfd and'pidfd_open('not in pidfd.split('// Unsupported')[0],
 'actual_fd_enrolled_before_result_length_check':pidfd.index('*state=State::Owned(fd)')<pidfd.index('if size!='),
 'close_latch_precedes_actual_fd_close':pidfd.index('*state=State::CloseStarted(fd)')<pidfd.index('unsafe{close(fd)}'),
 'no_dependency_ddl_or_registration_edit':all(not p.endswith('.sql')and not p.endswith('Cargo.toml')and not p.endswith('Cargo.lock')and'service_registration.rs'not in p for p in after),
 'real_missing_grant_factory_explicit':'No concrete authority implementation is falsely supplied'in(root/'CHILD-HOOKS.md').read_text(),
}
assert all(checks.values()),checks
result={'scope':'source proposal and actual API hook composition only; native grant factory incomplete','checks':checks,'passed':sum(checks.values()),'compiler_runtime_or_cu_run':False,'ddl_dependency_or_shared_edits':False,'native_grant_factory_or_full_web_ready':False,'os_peer_package_or_pidfd_qualified':False,'full20MiB_or64MiB_qualified':False,'patch_bytes':len(data),'patch_sha256':hashlib.sha256(data).hexdigest(),'remaining':['Root approved package-pair and retained peer/process/window enrollment constructors','real pipe IO/OVERLAPPED custody and verified control frame reader/writer','startup/discovery broker factory wiring, old-service Web upgrade state','unchanged upstream asset/read/SSE/PTY/effect route closure','concrete child authority/auth implementation and six commands from actual owner','compiler/OS/runtime/20MiB/full release acceptance']}
(root/'review.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':result['passed'],'patch_bytes':len(data),'patch_sha256':result['patch_sha256']}))
