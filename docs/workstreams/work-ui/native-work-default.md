# Native Work default source proposal

The actual native entry rendered MvpDesktop and therefore did not enter the reviewed Work conversation surface. This proposal changes that entry to DesktopEntry → NativeWorkDesktop → the existing App. It keeps DesktopEntry's authenticated-ready boundary, the original native gateway, engine/profile checks and all original admission owners. It does not alter the Next/Linux Work implementation.

## Exact source

- Native base: `61c99f8e649da85b600fccec93236b5d6b07f78b`.
- Patch: [native-work-default.patch](native-work-default.patch).
- SHA256: `b53c80a5ee3ff2f9a08f4e1acb306eb6e075eba76dcf2c5f4f1955c277a61795`.
- Patch bytes: 24816.
- Seven allowed frontend paths: main entry, App, and five new files under features/work-ui.
- Native branch remains at the base. Exact frontend changes are staged, uncommitted pending the coordinator's normal web pre-commit gates; no hook was bypassed.

NativeWorkDesktop opens Work by default. Existing connection/qualification/engine diagnostics are lazy and require the explicit rail action. The native App remains mounted, inert behind the modal, retaining its original draft/admission state. Returning closes diagnostics and restores focus. The diagnostic view retains its existing service URL validation and IPC owner; no new Tauri call or transport was added.

App retains its existing Projects, tasks, native/WSL environment, profile, worktree, transcript, tools, permissions/forms, receipt recovery, scheduling, memory, artifacts, browser, image, office, Sites, maps and other feature owners. Existing settings, search, navigation history, panel layout and model actions stay reachable. The Work projectless landing invokes the original scratch-chat owner only on a user action; it never manufactures a second project/conversation ledger, loads a model or sends a prompt.

NativeWorkPresentation wraps the existing Workbench without keying or recreating that child on a Work/Web change. It retains the full viewport box with visibility plus inert/aria-hidden fencing. Native composer drafts, attachments, pending originals/outcomes, transcript and scroll remain within their existing owner. Inspector and terminal visibility are local presentation choices; the existing compact-review action can still open the inspector. Pending approvals/forms remain rendered by the original main conversation controller. All enabled operational actions remain original native controls.

The visual proposal uses the existing native theme/text-scale tokens, a 52px rail, centered maximum740px composer and optional tools/terminal panels. Existing sidebar persistence, resize bounds and compact collapse remain authoritative; this proposal does not silently rewrite saved widths to match screenshot pixels. The supplied original Work reference remains the final visual contract. Inspection of the preserved native workspace concept informed owner/panel reuse, not acceptance of the new candidate.

## Missing Web boundary

The native Gateway has a workbench request port and OpenCode configuration lifecycle, but no qualified upstream exact-session Web host/launch port. Therefore Web explicitly reports unavailable, launches no iframe/window, and offers Return to Work. A shared service URL from diagnostics is not evidence for a native engine session binding.

Coordinator-owned contract work must supply a qualified exact native service-instance/actor/project-revision/environment/cwd/session binding and authorized upstream origin/protocol, with expiry, identity invalidation and history/approval synchronization behavior. It must preserve existing CSP/IPC restrictions and upstream source. No token, route, host, launch capability or successful Web handshake was fabricated. Actual Work/Web cross-view interoperability remains open.

## Validation and remaining gates

Source review traced the entry, DesktopEntry, App, Workbench, original scratch/admission owners, native Gateway and sidebar/layout owners. Native cached diff whitespace check passes. Four new semantic React cases cover retained mount/draft/scroll and unknown admission across Web return, scope-change return to Work, explicit optional panels, and lazy diagnostic open/return/focus with the App owner retained.

These React tests and native type/build checks have **not** been run by this worker. Requested central checks use existing locked dependencies only:

```sh
npm run check --workspace=@veyra/web
npm run test --workspace=@veyra/web -- src/features/work-ui/NativeWorkPresentation.test.tsx src/features/work-ui/NativeWorkDesktop.test.tsx
```

The coordinator must also run original App/Workbench/DesktopEntry regressions, normal web/native commit gates and its scheduled package check. Native window/DPI/keyboard/200% scaling, actual admission/engine/Stop/recovery, diagnostic access, screenshot comparison and qualified upstream binding remain unverified. Existing47 passing Next Work React tests do not prove this native patch.

## Storage and cleanup

The additional native checkout was pre-existing, clean and explicitly transferred by the coordinator; no checkout/chat/worker was created. All source, patch and this minimal review record remain inside the same approved task root and C-backed physical volume. No dependency tree, compiler output, cache, download, runtime, device or inference workload was created. Removed paths: none. Removed bytes: 0. Durable source/patch evidence is retained for coordinator integration and regeneration from the recorded base. Original source, locks, screenshots, credentials, models and prior evidence remain protected.
