# Exact private-conversation upstream Web audit

Source audit only. This proposal supplies a concrete original-owner observation producer and a closed host/proxy contract. It does not implement or qualify a native Web surface, expose a URL, alter upstream code, or close functional Web acceptance. Root owns Rust/Tauri/proxy wiring and real native/browser acceptance.

## Confirmed current source

Inspected staged blobs (read only; no Native writes):

| Path | Git blob |
| --- | --- |
| crates/adapters/src/opencode/mod.rs | 36591fea667e082b58b2ef782d6ae8089b32464d |
| crates/adapters/src/opencode/desktop_runtime.rs | 2d4b2829a5333e1390b916406ca8056f52c6f511 |
| crates/adapters/src/opencode/desktop_runtime/local_workspaces.rs | 81498a2898c80ce87cd98095645cfb5368fab45e |
| crates/adapters/src/opencode/desktop_runtime/task_permissions.rs | 162068cfbd39ecfd891936caf11e6929cfeab8cb |
| crates/adapters/src/opencode/owned_windows/retained_dispatch/protocol.rs | 82261ed8ba0266f8f4f64c7d4b7cba29b0dcba71 |
| apps/desktop/src-tauri/src/native_browser/webview2.rs | 2f5117886e7960119e28ffeb3519b8f8ec49f5bc |
| apps/desktop/src-tauri/src/service_workspace.rs | 51b6e9097b1d37e0e7e5bb4a32fa4d8ce9871757 |

OwnedEngine retains the original process/registration/client and private auth. OpenCodeClient constructs exact API requests with its captured base/auth, no ambient proxy or redirects. FixedTransport exposes specific retained operations, not HTML/asset/SSE/WebSocket serving. Local require_local_engine verifies the real private binding/environment and refuses relabeling Project account/plugin/assistant/isolated owners. current_engine_instance_id verifies registration against the retained process, instance and version. Native browser and service workspace constructors create top-level windows; neither proves an embedded Work viewport or exact private engine/session host.

The proposed web_binding.rs uses those actual constructors to observe the complete real owner, session/directory, engine project/instance/revision/PID/version under the existing engine lock and current callback. Root must first authorize its original registry and committed session reference. Register it only as a private local_workspaces module. It deliberately returns metadata, not a qualified host or connection URL, and was not compiled by this worker. Root must review it against its current source and revalidate every request; metadata cannot retain a process by itself.

## Unchanged upstream protocol verified from primary versioned source

The exact session route uses the encoded server key. [Upstream session route](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.11/packages/app/src/shell/routes/session.ts).

Production Web chooses location.origin as its HTTP server. A proxy path under the Veyra origin therefore cannot by itself target the private engine. [Web platform](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.11/packages/app/src/runtime/platform/web.ts).

HTTP connection identity uses its URL; desktop sidecar/WSL/SSH keys differ. [Server registry](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.11/packages/app/src/runtime/server/registry.tsx).

The entry registers root /sw.js and also supports token-query bootstrap, which this design must avoid. [Web entry](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.11/packages/app/src/entry.tsx). Its API factory can attach Basic auth from renderer-side credentials; this is not acceptable for the private host. [API factory](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.11/packages/app/src/runtime/server/api.ts).

The browser draft store uses origin-scoped IndexedDB with document/blob retention. Preserve its mounted Webview/profile rather than inject or copy private storage. [Draft store](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.11/packages/app/src/runtime/persistence/drafts.ts).

Prompt creation accepts optional message identity and richer fields than Local AgentTurn{text}; the protocol also has direct session creation, model/agent changes, fork, command, shell and other mutations. A text-only proxy loses workflows; a generic proxy bypasses local originals. [Session protocol](https://raw.githubusercontent.com/anomalyco/opencode/v2.0.11/packages/protocol/src/groups/session.ts).

## Concrete Root implementation boundaries

1. Original service creates an opaque host binding only after the producer observation, actual retained native/WSL owner, served asset manifest and complete endpoint-to-original-owner mapping qualify. Hold that identity in a private host record; no private URL, credentials, caller-chosen method or principal reaches the renderer. Bind expiry/revocation/restart to the full owner and engine epoch. No new engine, model, session or Project is created by reading or showing Web.
2. Root supplies a stable dedicated proxy origin and native in-place Web surface with no application IPC. Native derives the verified session route internally and admits only that proxy origin. Preserve the mounted surface/profile across Work/Web changes. Existing generic top-level browser windows are not an in-place implementation; do not report them as one.
3. Serve the exact pinned asset manifest at root, including its declared SPA/service-worker paths; verify actual served hashes. The proxy owns its browser session/cookie internally and injects original engine auth only server-side. Do not pass auth_token or engine registration to Web. Never rewrite upstream JS/HTML or fabricate history.
4. Build a finite full endpoint manifest from the actual served protocol and normal user workflows. Typed reads go to only the captured private engine and committed references. Route every mutation through its real retained owner with complete lossless payload, a durable before-effect unknown fence, stable request identity and original lookup. Existing text-only LocalPromptOriginal cannot stand in for attachment/command/shell/form/permission originals. Inspect actual unchanged UI ID construction before claiming retry identity: optional IDs in the protocol are insufficient proof. Never deduplicate by text, allocate new IDs on an uncertain retry, or replace the existing registry with fake Projects.
5. Preserve both existing draft owners and re-read actual native state when returning to Work. Do not infer prompt admission from Web history or idle. Keeping both drafts is not evidence of a single shared unsent buffer; shared draft transfer needs a real public upstream handoff and separate acceptance.

The complete asset/endpoint manifest, in-place native constructor, stable Web-ingress original mapping and actual same-session acceptance are the remaining concrete blockers. contract.json records them without reducing the requested normal Web scope. No runtime endpoint, credentials, user content, running-service request or new process was used in this audit.
