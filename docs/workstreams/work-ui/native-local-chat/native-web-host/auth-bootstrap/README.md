# Native exact-origin auth bootstrap

Bounded owned source proposal, not a service lease/proxy factory. No shared Native/Cargo/lock/cache file, existing host source, profile or user state was changed. No browser, child, process, runtime, model or GPU work was started. Root owns compilation and actual native/auth/normal unchanged-Web acceptance.

## Actual cached interfaces

Read the existing native cargo-home only: webview2-com/sys 0.39.1, its callback macro 0.8.1 and windows 0.62.2. api-evidence.json records exact paths, hashes and declaration lines. verify-api.py checks nineteen declarations across four cached files without copying sources or invoking Cargo.

- BasicAuthenticationRequested is available through ICoreWebView2_10 with add/remove callbacks and exact i64 tokens. This proposal registers cancellation only and never calls Response.SetUserName/SetPassword, avoiding intentional browser Basic credential-cache population.
- ICoreWebView2_22 supplies exact add/remove request filters with document/shared-worker/service-worker source kinds. No fallback to the older filter is permitted. Args2 supplies the actual source kind.
- Request.Uri/Headers, SetHeader/RemoveHeader and SetResponse/CreateWebResourceResponse support native request handling. Header bytes are supplied only through the original private lease's native callback; no credentials are returned, serialized, placed in URLs/scripts/cookies or included in error/log data.
- Event callback create returns the actual COM handler interface. Registration objects, core interfaces, handlers and exact tokens stay in a child-keyed UI-thread registry, not a Send wrapper or renderer object.

The component requires Root's NativeAuthLease: actual child label, exact proxy origin, cheap current original owner/epoch check, current original no-redirect proxy invariant, private proxy-only Basic header sink and static-code fault queue. This is not a constructor for qualified metadata. Original engine credentials must never be supplied. The fault callback must enqueue protection/reconciliation without reentering COM or this registry.

## Request behavior

Strip Authorization and Proxy-Authorization before checking every intercepted request. Check actual sender COM identity, exact scheme/host/port, no URI userinfo/fragment, known source-kind bits, enabled/cancelled state and current original lease. Only then write one bounded native Basic header; recheck current state afterward. A foreign, revoked, unsupported or failed request receives a native empty 403. Headers/URI/errors are never formatted into diagnostics. All Basic challenges are cancelled; this adapter supplies no browser credential response.

This is an auth component, not a generic forwarder. Root's proxy still owns the complete finite paths, lossless payloads, original admission/recovery and unchanged asset identity. Blocking a required normal request is not full functional Web acceptance.

The cached resource-request args have no redirect-chain flag. A top-level navigation IsRedirected flag does not cover subresources. The component therefore cannot independently prove a request is not redirected. Root's actual original proxy must refuse upstream redirects and prevent any browser-visible 3xx before issuing its current no-redirect invariant. Cached/service-worker synthetic redirects and installed-runtime event coverage also require qualification; source checks alone do not establish them. If that proof is absent, Root must keep the host unqualified. Do not treat denial of required normal redirects/routes as successful unchanged-Web delivery.

## Exact integration and cleanup

The only imported-host delta is in auth-from-2c.patch: add detach_child_auth(child) to its existing original authority, invoke that hook before child.close and release_proxy, and add the new local_web_auth module. It does not duplicate the old host or implement the service factory. integration-inputs.json records the exact 2c host preimage and patch hashes; Root reconciles its current source. Add a Windows-only private module declaration and implement both hooks using the actual retained native authority. Existing dependencies already supply the inspected API; no Cargo/lock change is proposed.

Root creates and retains Attempt with a canonical UUID and exact child before invoking install from an off-UI worker. with_webview executes COM on the actual child UI thread. Installation is allowed once; repeated calls inspect instead of adding callbacks again. Callback cancellation precedes the resource handler/filter; the fuse stays disabled until every positive add acknowledgement and current lease check succeeds.

Attempt receipts expose only attempt_id and Attached/NotAttached/RetainedUnknown to the privileged native owner. Root must not expose this component as a renderer command. A timeout or lost dispatch acknowledgement disables the fuse permanently and retains the exact attempt. Late completion cannot reenable it. An unknown add retains its observed token value without claiming ownership or attempting guessed removal. A second registration for an already-owned child cannot report a successful no-callback state.

Before closing a child, call Attempt.detach while the original UI-thread interfaces are still alive. Disable the fuse first, remove each positively owned exact callback token once, wait for zero active callbacks, then remove the exact owned filter. An unacknowledged removal remains unknown and is not repeated; other positively owned callbacks are still reconciled. Only positive removal of all owned hooks, or an original completed install that never enrolled anything, permits NotAttached. Missing registry state alone, timeout, foreign child, incomplete install or callback/filter failure never permits success. Retain the attempt/core/handlers/private lease and report a static fault for Root reconciliation. No cleanup runs from Drop; no browser cache/profile clearing or process kill substitutes for token removal.

Root's service/proxy authority release must be gated on that positive receipt and subsequent positive child close. Actual revocation/protection must hide the view and refuse new private requests while an unknown callback state is retained. Credentials remain native and the original authority remains owned; do not release or erase it to make a cleanup report pass.

## Validation and storage receipt

Cached API declaration checks: nineteen verified, not Rust compilation. Five Rust fixtures are supplied for origin substitution, failed-add token ownership, exact-once successful removal, unknown removal retention and independent cleanup of another known callback. They were not executed by this worker. Root must compile/run them with the ordinary resource guard, then qualify real initial document/assets/fetch/SSE/worker/WebSocket coverage, no browser-auth-cache/redirect/foreign-origin credential forwarding, lease revocation, callback quiescence, partial install/timeout/detach, unchanged normal workflows and positive native cleanup. No runtime success is claimed.

All new durable paths are under native-web-host/auth-bootstrap in the existing approved C-backed task root. Regenerate minimal API/patch receipts with python -B verify-api.py and prepare-integration.py. Retain canonical source, tests, exact delta and API hashes for Root integration/review. No dependencies, compiler outputs, cache copies or disposable bulk were created. Removed paths:none, measured removed bytes:0. Existing cached crates are protected read-only inputs; no disk recovery is claimed.
