# Private broker contract approved by Root, concrete integration gates

No ordinary bearer/renderer/Origin fallback. No claim against malicious fully
privileged same-OS-user/root. No execution or OS queries have run in this worker.

## Original startup and discovery

The actual ServerOriginal retains a new NativeControlOriginal alongside its
existing guarded service state/public listener. Prepare the broker owner and
retained bind/accept/join cells BEFORE any OS create/connect. Do not create a
second ServiceState, ProjectStore, supervisor or independent registration.

Use Registration.instance_id and existing library/registration guard lifecycle.
Broker protocol epoch1 discovery name is a deterministic instance-scoped locator,
not authority: Windows `\\.\pipe\Veyra.NativeWeb.<instance UUID>`; Linux a socket
under the actual OS-user private runtime directory with ownership/mode and path
length checked before bind. Do not silently fall back to another directory.
Root finalizes the advertised optional protocol descriptor/old-reader behavior.

For a new service, broker creation/retention belongs before registration readiness
publication. A private Web capability is unavailable until its broker is live.
For discovery, connect only through the same retained CapturedConnection and
recheck the registration/service process/instance; a missing broker on an old
service returns WebProtocolUpgradeRequired while every normal feature continues.
Never bootstrap, replace, migrate or stop the old service merely to obtain Web.

Windows creation: current-user SID protected DACL, no remote clients,
FILE_FLAG_FIRST_PIPE_INSTANCE on the original first instance, bounded instances/
frames and exact named-pipe server/client kernel PID query on each actual accepted
endpoint. Tokio1.53.2 ServerOptions exposes first_pipe_instance,
reject_remote_clients and create_with_security_attributes_raw. It provides only
AsRawHandle for its pipe objects; no safe into_raw_handle disposal method exists.
Do NOT manually CloseHandle behind Tokio or call Drop a checked close. Root needs
an actual original pipe I/O/OVERLAPPED/close custody adapter and real join result.

Linux creation: private0700 user directory and0600 UDS, real peer_cred UID/PID on
the actual accepted UnixStream. Obtain SO_PEERPIDFD from that SAME socket, then
capture process start identity and the
actual /proc/<pid>/exe file before trusting the peer. Retain those objects across
the full connection. Existing Rust ServiceProcessObserver is Windows-only and
existing WSL supervisors' pidfd JSON is not this broker's pidfd owner. The Linux
native approved process/package owner is a real missing factory; do not substitute
its reported PID. linux_peer_pidfd.rs supplies the actual socket-bound pidfd cell
and same-object poll/checked one-shot close source. It does not mint approval.
The Linux kernel source returns a pidfd from the socket's retained peer struct pid:
[Linux net/core/sock.c](https://github.com/torvalds/linux/blob/master/net/core/sock.c).
Unsupported peer-pidfd kernels must remain a Web protocol gate; reopening a
numeric credential PID can attach a reused process and is not a fallback.
Unlink only the exact original socket dev/inode after actual listener/workers end.

## ApprovedPackagePair and peer admission

Required source fields: selected protected manifest original handle/dev+file ID,
manifest SHA256, package/build/source identity and architecture; Desktop and service
role executable handles/dev+file IDs and SHA256; applicable publisher policy and
validated installed selection/rollback lineage. Existing InstallationInspection
report says observed/not-independently-verified: that DTO is NOT this owner.
The actual startup/package-selection source must mint and retain this capability.

Each control connection retains its actual IO first, then captures the kernel
peer PID/UID. Keep an actual process HANDLE/pidfd, birth/start identity and the
approved executable/source observations while validating it. Bind service-side
Desktop role and Desktop-side service role to that same original package pair,
service instance and library installation. Repeat liveness checks against the
retained object, not a reopened reported PID. No process-stop rights or signals
are granted by a query/synchronize observation handle.

kernel_peer.rs supplies real specific Tokio/Win32 peer query source. It intentionally
returns facts only, not an approval/retirement token. The missing retained process/
package constructors are required before any actual child grant can be issued.

## Minimal bounded control frames for Root finalization

All are length-delimited with a fixed maximum (proposed64KiB) reserved before read;
no unbounded serde Value or token logs. Keep the actual partial prefix on failure.

- Hello: protocol epoch, exact service instance, actual package/source manifest
  identity and fresh connection nonce. These fields are consistency expectations;
  OS peer + original package objects supply authority.
- BindWindow: native constructor's window UID/lineage and selected view intent.
  Windows can additionally check actual HWND owner PID against the retained peer.
  Do not accept a renderer window label/Origin as that source. Linux Wayland uses
  approved Desktop native-constructor lineage, not a fabricated global window ID.
- SelectScope: expected saved workspace/session/runtime selection. Service obtains
  actual current LocalWorkspaceBinding/LocalWebLease through web_original::acquire,
  same service state and original writer. Expectations alone grant nothing.
- ChildLease: original scope ID/epoch, listener origin/entry descriptor, native-only
  scoped credential and profile identity, sent only on that retained peer channel.
  Actual listener custody and complete route closure must exist before a usable
  grant is returned. Renderer receives only opaque lifecycle IDs/status, no secret.
- Revoke/Close/Observe: refer to the same original scope/connection/window. A lost
  reply retains the original and reconciles; it never repeats a create/effect or
  converts disconnect/EOF into engine/agent/goal retirement.

No DDL/version/dependency change or executable wire enum is activated here.

## Desktop and child ownership hooks

Add a host-owned per-window original registry at actual main/detached Rust window
construction. Retain the real window plus a native UID and its trusted bundled
Webview identity before callbacks/commands can select Web. Update current selection
through that owner and confirm actual service saved scope over the verified broker.
An IPC DTO is only a requested selection; it never constructs a grant object.

NativeControlOriginal retains the exact connection/process/package source and
an original reader/writer task before sending BindWindow/SelectScope. On reply,
the same owner retains ChildScopeOriginal before child construction. Implement
OriginalWebAuthority with this concrete original, and NativeAuthLease with the
exact created child's identity/current source; no generic positive callback.

LocalWebChildren::create already provides the real about:blank child before
authorize_child. Retain Attempt::new(actual child, same lease) BEFORE install.
Only actual Attached allows navigation. All callback/late-creation/close errors
remain in the same host registry. Do not overwrite an unknown original on retry.

Dedicated private receiver is constructed inside the service's accepted native
window scope and reuses the same state/binding/lease/writer. private_receiver.rs
mounts a real prompt Router; private_listener.rs composes the actual original
ListenerStartup/Listener/Book/ResultJoin without a new writer. Its address is not
a whole-Web-ready witness. Factory wiring and actual asset/read/SSE/PTY/effect
adapters remain required before the child can navigate unchanged upstream Web.

## Ordered retirement and buffering

Disconnect/reselection fences new effects immediately; scoped HTTP auth and fresh
service lease checks remain required even if the child still holds old headers.
The broker must link actual peer disconnect/window-destroyed/current-selection
events to that same scope's fence before admitting replacements. Message loss or
an uncertain native-view observation is not permission to keep it current. The
current prompt receiver's service lease check is not a substitute for this missing
native peer/window-current source; its factory must not activate until linked.
Observe actual callback detach and child removal before releasing its receiver.
Close the accept gate, drain retained HTTP connections, observe actual server/
control reader/writer joins and checked listener/pipe closes. Failures remain
attached to their exact original; no new budget, alias count or missing handle
can mint success. Engine/request/read/byte ledgers remain independent.

The prompt handler begins charged native intake before first Body data poll.
Hyper may pre-read bytes while parsing headers. Its fixed/max read buffer, header
count/bytes, active sockets, decoder, TLS (if later added), task stacks and output
wrappers require separate bounded configuration/measurement. No Request<Vec> is
called pre-read ownership. Full20MiB and64MiB payload/whole-process limits remain
unqualified, and complete Native/Windows/Linux/runtime/visual acceptance is open.
