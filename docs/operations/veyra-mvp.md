# Veyra MVP status and verification

Updated 2026-10-29. Both candidates run and have been exercised. Phase 1 remains open for visual review, targeted Windows checks and the explicit gates below. The full seven-phase goal remains active.

## Qualified candidates

| Candidate | Exact identity | Evidence |
|---|---|---|
| Shared service | Source 5bb3755c37f741d855d082618ab58b375d063e0e | 153 focused API/dashboard/fixture/browser checks and dashboard TypeScript passed; complete cold Docker build passed |
| Linux image | docker.io/jtmb92/ingenium@sha256:1925d5695fba242f4990748473f72d847276c10ae721be13173e974dc404ec50 | Actual cluster Pod Ready, zero restarts at observation; pinned tools and protected deployment qualified |
| Chart promotion | branconet-charts 1c6f142493685676f9d8fee339400e0fe8d22ee5, chart 0.1.22 | Reviewed PR 29, singleton publisher prepare/check/publish chain and actual Flux revision agreed; Actions stayed off |
| Windows GUI | SHA-256 9b12093dd7844f35ccdffa17f6ec2b0c3bd783bf1aae3a2fc5815c63d067a8f4 | Actual native WebView dev sign-in, native/WSL project selection, executed terminal output, reconnect, close-to-tray and single-instance relaunch observed |
| Windows service | SHA-256 f84de6058f327e6949f912531fd917644e3395df4a84338f3272b601e244c34a | Authenticated stable-path runtime; native Windows and selected-user Ubuntu terminal execution, resize, reconnect and owned close qualified |

Source/build checks, observed workflows and complete product acceptance remain separate. Windows source is in the existing [veyra-dock lineage](https://github.com/jtmb/veyra-dock); its reviewed Phase 1 source checkpoint is 1df8e22155f8aeecb7745227055580f920667bbb on codex/veyra-phase-1-desktop, with an exact matching remote SHA. Its required source/skill/74-feature registry, Rust and frontend-type commit gate passed; this does not accept the open native lifecycle/visual gates.

## Live workflows

- Current source 5bb3755c37f741d855d082618ab58b375d063e0e follows the user-supplied compact Chat composer direction while retaining the original colour tokens. Production browser checks align attachment, textarea, model picker/caret and actions within 1 px, retain keyboard focus, and keep mobile controls inside the composer. The live service shows standard GPT-6 Luna selected and Fast as a distinct alternative. One bounded prompt completed through the actual composer with native history reporting openai/gpt-6-luna; a normal reload preserved exactly one prompt and response. The existing account and all five full project records survived replacement.
- The preceding 42c4124 qualification started a fresh Home openai/gpt-6-luna conversation. The assistant response appeared after navigation to Chat without reload. Native session history confirmed one original user prompt and one completed response. A second turn streamed and was cancelled through the actual Stop control; the provider history recorded interruption and the composer became available again. History and normal reload preserved both turns. No prompt replay or tool execution was used.
- The original account and all five project identities survived both image replacements. The same PVC/PV/Longhorn volume, two healthy replicas and native Secret identities were retained; all 125 migration files remained unchanged.
- Fresh OpenCode 2.0.11 runtimes in native Windows, selected WSL and the deployed Linux image discovered 23 pinned external skills alongside eight Veyra skills and loaded the exact representative skill body. Linux retained one active Goal integration and the protected broker. Ordinary Chat used ingenium-chat and excluded Goal. These skill checks requested no inference.
- Prior-candidate Mail qualification recovered sync after normal Vault recovery. All four folders completed fresh background sync in that qualification. The owned verification message also opened in list and full-message views; its cached body proves persistence separately from fresh sync. No new mail was sent in this qualification.
- Existing saved Docs content reopened after replacement. Standalone Docs preserved the page state when returning through its space picker; editing inside standalone remains unfinished. The browser blocked its pop-up control.
- Actual upstream OpenCode Web and code-server loaded. VS Code retained its existing Restricted Mode; no workspace trust change was made.
- LAN HTTPS passed hostname/chain validation using the existing public CA, normal dev sign-in/session/project checks, wrong-origin write rejection and logout of only the verification session. Windows Schannel revocation-check failure is retained separately; no certificate-warning bypass was used.
- The existing information-only tunnel resumed using its stored token and existing Vault recovery credential. Homepage, privacy and terms returned 200; private API, Chat and environment-file paths returned 404 without cookies. Tunnel configuration and disabled private routes were unchanged.
- Requested Chat and synthesis Luna selections persisted after replacement. The provider schedule remained one hour; secondary/custom provider settings were preserved.

## Windows boundaries

The Tauri companion reuses native service authentication, project contracts, Windows/WSL selection, ConPTY terminals and tray/single-instance behavior. It opens the chosen shared UI in an origin-restricted top-level WebView with no native IPC. Local execution stays in the selected native or WSL project. A selected Windows task never silently executes in WSL or the cluster.

The existing Windows inference engine, profiles and models remain unchanged. The isolated service's zero displayed profiles coexist with a configuration-unavailable diagnostic; this is not a healthy empty engine. Whole-service shutdown returned an unknown-state refusal before model-work reservation. Its original result and static diagnostic are retained; graceful service exit is unqualified. No model/GPU workload was requested. The dormant legacy task catalog returns unavailable and is not a completed native coding workflow.

The actual portable GUI and service are retained as runtime consumers, together with the isolated qualification profile. The original installed preview and user profile remain protected. Installer, signing, complete local-agent execution and cross-origin identity-provider authentication remain open.

## Credentials and recovery

The user explicitly authorized saving and reusing the existing development credentials. The operator-private .env is retained outside Git, images and packages with an account-only Windows ACL. Native WebView, browser and API checks successfully reuse it; do not request another user sign-in for this authorized account. Package scans found neither saved credential value in its 511 files.

A private recovery helper signs in through normal CSRF/login, optionally performs normal step-up and unseals only the initialized existing Vault using its separate existing recovery file, then resumes only the already enabled information-only connector. It refuses changed tunnel scope, preserves configuration and keeps cookies/credential values in memory. Verification mode passed and logged out its own session. Recovery never initializes/resets Vault or creates/rotates credentials. A credential or account change would be a different operation.

## Visual review and unfinished gates

[Every contracted view](../design/veyra-mvp-review.json) has its original baseline hash, historical fixture hash, available live captures and an explicit unfinished-work disposition. All 47 fixture image hashes were reverified; the fixture archive includes older/loading/error states and does not establish current runtime or visual acceptance. All 20 Settings categories were visited. Account and many feature categories use links to their existing workspaces; these differ from inline settings compositions.

[Eight additional Windows states](../design/veyra-windows-mvp-views.json) are proposed for review with exact captured hashes, dimensions and GUI identity. They supplement the original 47 baselines. No baseline was replaced and no visual approval is inferred. See the [review guide](veyra-mvp-review.md).

Remaining gates include Home Needs Attention review/job actions; global search, microphone, typography/motion and other depicted additions; saved-memory edit/forget and checkpoint restore-as-new; full synthesis/proposal/approval/activation; Mail send/receive and smart replies; Secret consumers/rotation/audit; account/invitation/MFA flows; complete feature mutations/persistence/isolation; native creation-dialog/first-run/recovery/tray/exit states; keyboard/focus and 100–200 percent scaling; and continued review of the native lifecycle states. Usage currently has no project mapping, zero recorded requests and no sync timestamps; no speculative mapping was written.

## Storage, reproduction and rollback

The user-approved C-backed WSL task root and paired native NTFS exception share the same physical C: volume and combined 20 GiB ceiling. Cargo home, compiler targets, npm/cache/temp and isolated runtime state are confined to those registered roots. Full native Cargo/SQLite on the WSL share failed; the approved native root is explicit, with no silent drive fallback.

Consumed host dependencies, inactive BuildKit data/tools, both consumed OCI generations and the consumed recovery source context were removed after their final consumers and preservation/reference checks. Exact lossless registry regeneration reproduced the original OCI tar SHA-256 before retirement. Minimal hashes, recipes, failure evidence and receipts remain private. The native target retains 6,021,045,248 inventoried allocated bytes because automatic approval review rejected its recursive removal (blocked by policy). The native Cargo home retains 674,405,376 allocated bytes pending its final live-reference cleanup check. Its corrected registry-cache audit matched all 384 archive checksums to Cargo.lock and all 17,730 extracted files to those archives; the earlier directory-vendor checksum requirement was inapplicable and its failed receipt remains preserved. Those exact targets were protected and were not retried through another path/tool. Other prior cleanup refusals, unique encrypted recovery material and active runtime/profile files remain retained for their specific preservation rules. Linux allocation recovery is recorded separately from measured Windows free space; no VHDX compaction or shutdown was performed.

Use the [Windows quickstart](veyra-windows-quickstart.md), [Linux quickstart](veyra-linux-quickstart.md), [brain setup/rollback](veyra-brain.md), [Kubernetes runbook](kubernetes.md), [visual contract](../design/veyra-visual-contract.md) and [full delivery plan](../plans/veyra-phased-delivery.md). Rollback follows the reviewed chart/operator flow and preserved prior image/configuration; never delete or recreate installation data, Secrets, profiles or models. No successor is created until the complete Phase 1 exit is reviewed.

The current exact-image check matched 333 packaged file hashes, protected broker metadata and the compiled model-ID fix. All 72 registry blobs and the immutable tag were verified. The official BuildKit digest exporter avoided a local OCI duplicate within the existing task ceiling; the original publisher credential helper and registry checks were reused. The bounded qualification Pod/ConfigMap were UID-conditioned removed. Cold startup included upstream child-process restarts before readiness; the Pod itself reached Ready with zero restarts. Full lifecycle acceptance remains open.

## Conversation identity follow-through (source qualified)

New conversation and History selections now keep the actual native session ID in the Chat URL together with its runtime and project. Initial canonicalization and removing a deleted selection replace the route; choosing another conversation adds a normal history entry. Back, Forward and reload retain the selected conversation. Failed explicit links retain their identity and error. New/send/model controls pause during creation or route navigation, preserving drafts on failed creation and preventing a navigation race.

Seven focused dashboard suites passed (39 tests), TypeScript passed, and both production-browser workflows passed in run ed4ef150-17d3-4e4c-ab7e-6ee6323317ac. The browser exercised creation, sending only to the new native ID, reload, History, Back and Forward. These are source/fixture results; the replacement image and a fresh live URL workflow remain pending publication.

The current deployed image was also reviewed in the actual Windows WebView on 2026-10-29: saved development sign-in succeeded, the original colours remain, and the compact composer displays standard GPT-6 Luna. The original GUI/service process identities and packaged executable hashes remain unchanged. Root dependencies previously retained for internal esbuild hardlinks were safely removed after proving every link stayed inside the exact target (1,131,462,656 Linux allocated bytes); the empty build-state directory was removed after excluding only terminal process records from the reference scan (4,096 Linux allocated bytes). Current test dependencies were regenerated from the unchanged lockfile and await their final consumer cleanup. Neither result implies Windows disk recovery.
