# Native Work default source proposal

The actual native entry rendered MvpDesktop and therefore did not enter the reviewed Work conversation surface. This proposal changes that entry to DesktopEntry → NativeWorkDesktop → the existing App. It keeps DesktopEntry's authenticated-ready boundary, the original native gateway, engine/profile checks and all original admission owners. It does not alter the Next/Linux Work implementation.

## Exact source

- Native base: `61c99f8e649da85b600fccec93236b5d6b07f78b`.
- Patch: [native-work-default.patch](native-work-default.patch).
- SHA256: `1294cbf1b5cf778cae5b08cc306583d8071f93e35d39451510af630af9c60672`.
- Patch bytes: 33594.
- Ten allowed frontend paths: main entry, App, and eight new files under features/work-ui.
- Native branch remains at the base. Exact frontend changes are staged, uncommitted pending the coordinator's normal web pre-commit gates; no hook was bypassed.

NativeWorkDesktop opens Work by default. Existing connection/qualification/engine diagnostics are lazy and require the explicit rail action. The native App remains mounted, inert behind the modal, retaining its original draft/admission state. Returning closes diagnostics and restores focus. The diagnostic view retains its existing service URL validation and IPC owner; no new Tauri call or transport was added.

App retains its existing Projects, tasks, native/WSL environment, profile, worktree, transcript, tools, permissions/forms, receipt recovery, scheduling, memory, artifacts, browser, image, office, Sites, maps and other feature owners. Existing settings, search, navigation history, panel layout and model actions stay reachable. No private/null-project execution owner has been qualified: Work-default New chat without a selected project is explicitly unavailable. Both the sidebar and landing disclose that state. The task-view Open project chat action also requires a selected project in Work-default mode.

The existing scratch workflow creates a real Project, not a projectless conversation. It remains separately reachable through Create scratch project or Resume scratch project creation. A shared intent guard wraps the original scratch owner before UUID/storage/gateway effects; every existing unselected New-chat fallback is refused under workDefault, including a stale callback invoked despite the disabled UI. Only explicit scratch-project intent can enter that original owner. Legacy App behavior outside workDefault is preserved. No engine/model load or prompt is added, and no second project/conversation ledger is created.

Normal unavailable-state copy explains the user's next action in plain language: choose a project/create a scratch project, or continue in Work with the conversation preserved. Internal host, protocol and private-owner details remain in these technical review documents.

NativeWorkPresentation wraps the existing Workbench without keying or recreating that child on a Work/Web change. It retains the full viewport box with visibility plus inert/aria-hidden fencing. Native composer drafts, attachments, pending originals/outcomes, transcript and scroll remain within their existing owner. Inspector and terminal visibility are local presentation choices; the existing compact-review action can still open the inspector. Pending approvals/forms remain rendered by the original main conversation controller. All enabled operational actions remain original native controls.

The visual proposal uses the existing native theme/text-scale tokens, a 52px rail, centered maximum740px composer and optional tools/terminal panels. Existing sidebar persistence, resize bounds and compact collapse remain authoritative; this proposal does not silently rewrite saved widths to match screenshot pixels. The supplied original Work reference remains the final visual contract. Inspection of the preserved native workspace concept informed owner/panel reuse, not acceptance of the new candidate.

## Missing Web boundary

The native Gateway has a workbench request port and OpenCode configuration lifecycle, but no qualified upstream exact-session Web host/launch port. Therefore Web explicitly reports unavailable, launches no iframe/window, and offers Return to Work. A shared service URL from diagnostics is not evidence for a native engine session binding.

Coordinator-owned contract work must supply a qualified exact native service-instance/actor/project-revision/environment/cwd/session binding and authorized upstream origin/protocol, with expiry, identity invalidation and history/approval synchronization behavior. It must preserve existing CSP/IPC restrictions and upstream source. No token, route, host, launch capability or successful Web handshake was fabricated. Actual Work/Web cross-view interoperability remains open.

The requested [minimal typed port proposal](native-web-port-proposal.md) maps current App/Workbench/task ownership to the native engine conversation, including the distinction between a saved task ID and an actual returned session ID.

## Validation and remaining gates

Source review traced the entry, DesktopEntry, App, Workbench, original scratch/admission owners, native Gateway and sidebar/layout owners. Native cached diff whitespace check passes. Six new semantic React cases cover retained mount/draft/scroll and unknown admission across Web return, scope-change return to Work, explicit optional panels, lazy diagnostic open/return/focus with the App owner retained, and no-project allocation refusal versus explicit scratch-project/legacy actions.

A dependency-free Node check of the actual scratch intent guard passes: Work-default New chat invokes the original owner zero times; explicit scratch-project intent invokes it once; legacy New chat remains permitted. The initial direct WSL env lookup could not find node; the check then used the existing absolute Node path with all task-scoped temp variables set. No installation occurred. This unit evidence does not establish native runtime admission or full App integration.

The exact patch reverse-apply check with whitespace errors enabled passes against the staged native source. A raw APP documentation diff whitespace check flags one-space blank context-line markers required by unified-diff syntax, not native source trailing whitespace. The exact patch bytes/hash are preserved; the Markdown-only whitespace check passes. No blanket whitespace exception or hook bypass was introduced.

These React tests and native type/build checks have **not** been run by this worker. Requested central checks use existing locked dependencies only:

```sh
npm run check --workspace=@veyra/web
npm run test --workspace=@veyra/web -- src/features/work-ui/NativeWorkPresentation.test.tsx src/features/work-ui/NativeWorkDesktop.test.tsx src/features/work-ui/NativeWorkNoProjectActions.test.tsx
```

The coordinator must also run original App/Workbench/DesktopEntry regressions, normal web/native commit gates and its scheduled package check. Native window/DPI/keyboard/200% scaling, actual admission/engine/Stop/recovery, diagnostic access, screenshot comparison and qualified upstream binding remain unverified. Existing47 passing Next Work React tests do not prove this native patch.

## Storage and cleanup

The additional native checkout was pre-existing, clean and explicitly transferred by the coordinator; no checkout/chat/worker was created. All source, patch and this minimal review record remain inside the same approved task root and C-backed physical volume. No dependency tree, compiler output, cache, download, runtime, device or inference workload was created. Removed paths: none. Removed bytes: 0. Durable source/patch evidence is retained for coordinator integration and regeneration from the recorded base. Original source, locks, screenshots, credentials, models and prior evidence remain protected.
