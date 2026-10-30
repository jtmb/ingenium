# Actual producer callgraph and exact missing constructors

This is a source proposal, not a claim of mounted/full Web/runtime acceptance.

## Current concrete source

Desktop:

1. main.rs wraps every generated invoke with ipc_origin::accepts(actual Webview).
   It validates actual label plus bundled/dev origin. A child shares the native
   Window but is rejected by its actual Webview label. Preserve this outer guard.
2. workspace_windows::open builds the actual trusted WebviewWindow on a retained
   creation path; main creates the main Work window. Neither records a native
   selected Work runtime/session binding yet. Renderer selections are requests,
   never authoritative runtime/window proofs.
3. service_client::initialized_snapshot returns the actual retained
   CapturedConnection. It carries Registration, directory and original startup
   deadline, verifies service process/instance, and never gives a child a token.
   initial_native::spawn_held uses null stdio. Discovery can attach an existing
   service. Thus an inherited startup pipe alone would leave discovery unsolved.
4. local_web_child::LocalWebChildren::create already builds an actual about:blank
   child with an original profile, retains it before fallible work, invokes
   authority.authorize_child, then navigates and positions it. It rejects foreign
   origins/popups and retains uncertain create/close attempts. No authority impl
   or managed child registry/six commands exists in main yet.
5. local_web_auth::Attempt::new/install/detach are real WebView2 calls. They bind
   the exact child and COM identity, strip ambient credentials, inject Basic only
   for exact private origin, cancel ambient Basic fallback and retain uncertain
   callback/filter cleanup. The NativeAuthLease implementation/factory is absent.

Service:

6. server::run_mode creates the actual state, guarded listener and NativeOriginal;
   ORIGINAL.enroll retains the whole owner before registration/start. The new
   broker must be a sibling original resource of that same owner, not a new
   service/ProjectStore or an independently discovered connection.
7. server::original::listener_resource::Listener retains the actual TcpListener,
   poll_accept under its retained cell and checked native retirement. The
   connections::Book reserves an IO/task cell BEFORE accept and retains the direct
   HTTP future and IO errors; connections::serve/run use actual ResultJoin.
   Reuse those concrete mechanisms for the dedicated private streaming listener.
8. routes::local_workspaces::web_original::acquire obtains actual current saved
   workspace/session and runtime LocalWebLease. capture/submit are genuine service
   facades through routes::live_agent into the same actual runtime and writer.
9. scoped_intake::receive_prompt accepts actual Axum Body, begins charged intake
   before the first data poll and moves that opaque original to capture. submit
   performs original journal/admission/send/publication and returns paged Body
   whose Bytes owners retain charge. These are not renderer/deserializable grants.
10. private_receiver.rs supplies a real private Router/handler composing9, checking
    one scope-bound secret/Host and current lease before Body polling. It supports
    the actual prompt route only. No ordinary public/bearer route installs it.

## Required real new call chain

Service original startup -> ApprovedPackagePair capture -> protected OS broker
resource enrollment BEFORE bind/accept -> published instance broker availability.
Existing discovery -> same retained CapturedConnection -> OS broker connect ->
kernel server PID/UID verification against that same original service instance.
No broker on old service -> ordinary features continue; Web upgrade required.

Actual trusted Rust/Tauri Work window construction/selection owner -> retained
native window UID + current view selection -> same verified OS control connection
-> kernel peer process + approved Desktop image/source verification -> actual
service current binding/session/runtime acquisition -> scoped receiver listener
created/retained -> native child lease sent on that retained private channel.
Root must compose the real assets/read/events/PTY/effect route closure before
returning a usable entry URL. Prompt-only router10 cannot mint whole-Web readiness.

Desktop original child authority -> LocalWebChildren::create -> exact returned
Webview -> service-bound native auth attempt retained BEFORE install -> actual
Attempt::install acknowledgement -> navigate original unchanged upstream Web.
Hide/show/query/close use that same host registry and actual child, not a supplied
Window label/Origin or copied visibility receipt. Selection change/disconnect
fences the original scope and new effects; it never fabricates retirement.

Actual child close -> observed auth detach -> positive child removal -> receiver
accept gate closed -> actual connection/listener/worker joins/checked closes ->
private lease retirement. Any missing/failed original remains in its registry.
Profile/drafts remain persistent user state and are never cleanup scratch.

## Exact contracts Root must finalize

`ApprovedPackagePair`: sealed startup-owner source, not InstallationInspection's
observed/not-independently-verified report. Retain selected protected manifest
file identity/hash, source/build identity, authorized Desktop+service role names,
held executable file identities/hashes, platform/architecture, publisher/signature
policy and actual process image observations. Never accept a renderer expected
hash/path or an arbitrary client executable as this authority.

`NativePeerOriginal`: accepted actual pipe/socket original plus kernel PID and OS
identity; retained actual HANDLE/pidfd, process birth/start identity and approved
executable/source check; original connection nonce/instance/manifest binding.
The kernel PID is only the lookup input; no PID/JSON boolean is an authority.
Recheck the same retained object; do not reopen a reported PID as closure proof.

`NativeWindowOriginal`: actual trusted Rust window constructor's retained window,
native window UID/creation lineage, current selected Work view/runtime/session and
control-channel ownership. Windows may additionally query HWND owner PID against
the retained peer, but HWND/label from a renderer is not the original. Linux
Wayland has no generic cross-process window-handle proof; trust the approved
Desktop peer's native constructor lineage, not an XID/renderer DTO.

`ChildScopeOriginal`: same actual service state/writer/binding/LocalWebLease,
original peer/window/source identities, private listener original + origin,
profile identity, native-only scoped credential, actual route-assembly/readiness
owner, lifecycle registry and original failure/closure records. Credential/URL/
profile/owner JSON alone cannot recreate this object after disconnect/restart.

These are exact missing producers, not substitutes implemented as positive
callbacks. private_receiver::Scope deliberately has no Deserialize/Default/public
constructor. Its broker child module can construct it ONLY after the real native
peer/window admission above. Root's contract/constructor wiring remains required.

## Resource and protocol limits

Header/auth/control frames must be bounded before decoding. A private listener
uses actual charged body intake before Body poll. Hyper/Tokio may already own
socket/header/read-ahead buffers; bound their configured envelopes and measure
them separately. Never call Request<Vec<u8>> pre-read charged ownership.

Linux UDS peer credentials authenticate only a local OS/namespace peer. They do
not authenticate a Windows Desktop across the Kubernetes/network boundary. No
TCP bearer/PID fallback may bridge that gap; such a deployment needs Root's
separate approved transport contract. Existing headless/ordinary APIs stay intact.

This distinguishes genuine approved native binaries from arbitrary browsers and
native-bearer clients. It does not claim resistance to a fully privileged malicious
same-OS-user/root that can alter approved code, inject it or control the OS.
