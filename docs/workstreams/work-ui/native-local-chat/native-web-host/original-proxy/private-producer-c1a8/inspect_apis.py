"""Pinned local dependency/API inspection only; no extraction/build/runtime."""
import argparse,hashlib,io,json,tarfile,tomllib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);p.add_argument('--registry',type=Path,required=True);p.add_argument('--tauri-registry',type=Path,required=True);a=p.parse_args();root=Path(__file__).resolve().parent
lock=tomllib.loads((a.native/'Cargo.lock').read_text());index='index.crates.io-1949cf8c6b5b557f'
selection={'tokio':['src/net/windows/named_pipe.rs','src/net/unix/stream.rs','src/net/unix/ucred.rs'],'tauri':['src/webview/webview_window.rs','src/webview/mod.rs'],'libc':['src/new/linux_uapi/asm/socket.rs']}
sources={};evidence={}
for name,paths in selection.items():
 pkg=next(x for x in lock['package']if x['name']==name);registry=a.tauri_registry if name=='tauri'else a.registry;crate=name+'-'+pkg['version'];archive=registry/'cache'/index/(crate+'.crate');raw=archive.read_bytes();assert hashlib.sha256(raw).hexdigest()==pkg['checksum'];rows={}
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz')as tar:
  for path in paths:
   member=tar.extractfile(crate+'/'+path);assert member is not None
   with member:data=member.read()
   assert data==(registry/'src'/index/crate/path).read_bytes();rows[path]=hashlib.sha256(data).hexdigest();sources[name+'/'+path]=data.decode()
 evidence[name]={'version':pkg['version'],'archive_sha256':pkg['checksum'],'source_files_exact_archive_sha256':rows}
pipe=sources['tokio/src/net/windows/named_pipe.rs'];window=sources['tauri/src/webview/webview_window.rs'];webview=sources['tauri/src/webview/mod.rs'];uds=sources['tokio/src/net/unix/stream.rs'];cred=sources['tokio/src/net/unix/ucred.rs'];uapi=sources['libc/src/new/linux_uapi/asm/socket.rs']
checks={
 'three_archives_match_actual_lock':len(evidence)==3,
 'six_primary_files_exact_archive':sum(len(x['source_files_exact_archive_sha256'])for x in evidence.values())==6,
 'actual_window_to_webview_asref':'AsRef<Webview<R>> for WebviewWindow<R>'in window,
 'actual_webview_parent_window':'pub fn window(&self) -> Window<R>'in webview,
 'actual_pipe_server_and_client_raw_borrow':'impl AsRawHandle for NamedPipeServer'in pipe and'impl AsRawHandle for NamedPipeClient'in pipe,
 'pipe_no_owned_into_raw_handle_api':'into_raw_handle'not in pipe,
 'pipe_security_attributes_api':'pub unsafe fn create_with_security_attributes_raw'in pipe,
 'pipe_remote_rejection_and_first_instance':'pub fn reject_remote_clients'in pipe and'pub fn first_pipe_instance'in pipe,
 'actual_uds_peer_cred_api':'pub fn peer_cred(&self) -> io::Result<UCred>'in uds,
 'actual_uds_uid_pid_accessors':'pub fn uid(&self)'in cred and'pub fn pid(&self)'in cred,
 'actual_linux_generic_peer_pidfd_constant':'pub const SO_PEERPIDFD: c_int = 77;'in uapi,
}
assert all(checks.values()),checks
result={'scope':'exact local primary source/API inspection; no OS calls or Native/peer qualification','dependencies':evidence,'checks':checks,'passed':sum(checks.values()),'compiler_runtime_or_os_queries_run':False,'broker_factory_complete':False,'kernel_behavior_reference':'https://github.com/torvalds/linux/blob/master/net/core/sock.c','kernel_behavior_limit':'SO_PEERPIDFD uses socket retained peer struct pid; target kernel/namespace support remains runtime qualification'}
(root/'api-review.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':result['passed'],'compiler_runtime_or_os_queries_run':False}))
