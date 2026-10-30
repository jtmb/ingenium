# Concrete constructor and child hooks

hosted_windows.rs records actual trusted main/detached Rust-created WebviewWindow
objects, parent Window, native UID and destroyed-event fencing. main/workspace
constructor edits in integration.patch supply the original values directly, not
an invoke DTO. There is no new renderer command to register a window.

After the accepted native broker exists, the create command obtains its actual
Tauri-injected Webview, calls HostedWindows::for_requester, and requests the
current saved scope through that same window's retained peer channel. Its body
contains only selection expectations. The service obtains actual binding/lease
under the original writer/runtime. The resulting concrete NativeChildAuthority
retains WindowOriginal, exact approved peer/package/connection and the service's
ChildScopeOriginal; no constructor from renderer JSON is allowed.

NativeChildAuthority implements existing OriginalWebAuthority using that retained
source. In authorize_child(actual Webview), retain local_web_auth::Attempt::new
BEFORE install; NativeAuthLease's child label comes from this actual returned child.
Its exact private origin/scoped credential comes only from the original verified
broker reply, held in native memory. The callback's cheap current/redirect checks
are revocation-only and cannot authorize a new effect; the service rechecks the
actual scope for every received request before polling Body or dispatching.

LocalWebChildren::create receives the same actual parent Window, concrete authority
and validated viewport bounds; it already retains the child before auth/install/
navigation. The native host must retain both registry and authority through lost
create/install replies. Do not overwrite an uncertain scope on another request.

Six narrowly registered commands may expose create/read/show/hide/bounds/close
using opaque IDs/status. Every command uses the actual injected Webview and
existing global ipc_origin gate, not a supplied parent label. Reading/showing
must match native WindowOriginal UID and current selection; cleanup remains
available after revocation. read uses actual retained child/native visibility,
not copied receipts. Closing uses actual Attempt detach and native child removal
before service listener/control release. Profile/drafts remain user state.

No concrete authority implementation is falsely supplied here while the real
native control/process/package/route-closure producers are absent. The exact
missing types/constructor owners are in BROKER-CONTRACT.md. Existing traits alone
do not qualify the feature, and this constructor registry cannot mint authority.
