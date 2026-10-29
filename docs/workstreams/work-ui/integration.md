# Coordinator integration requests and open gates

These are requests, not edits outside the Work UI writer territory. Current code deliberately uses isolated local consumer types; it does not freeze global DTOs.

| Owner / path | Minimal integration action | Acceptance |
| --- | --- | --- |
| Coordinator `components/MainContainer.tsx` | Include `/work` in immersive routes | Full-height canvas and bottom composer at reference viewport and 100–200% scaling |
| Coordinator `components/DashboardShell.tsx` | For `/work`, keep Auth/Organization/Project/Runtime providers and SettingsOverlay, suppress the duplicate topbar/navigation wrapper | One rail/sidebar, accessible single navigation hierarchy; settings still reachable |
| Coordinator `components/WorkspaceModeSwitch.tsx`, home/navigation registry | Point Work to `/work`; retain explicit unchanged upstream and CLI access | Work default routing, ordinary Chat separate, all47 existing views and20 Settings categories reachable |
| Coordinator chat defaults | Supply installation-owned defaults and safe supported reasoning metadata in the consumer adapter | New session picks explicit default; per-session choice never rewrites defaults; absent/unsupported variant recovery disclosed |
| Projects stream / coordinator contracts | Supply permission-filtered `WorkProject[]`, conversations/pinned preferences and admitted execution controls through `WorkShell`/`WorkComposer` slots | Projectless, same-name/multi-root/offline/native/WSL/cluster identity, branch/worktree, pin/rename/archive and exact binding behavior |
| Runtime/gateway owner | Verify unchanged upstream's same-session URL protocol, plus exact authorized directory and history reconciliation | Same selected engine session before/after Web; Web-side writes refreshed into Work without resend; session mismatch visible and send blocked |
| Memory, Dot, Voice, Customize streams | Wire `dot`, `memoryControl`, `voiceControl`, `permissionControl`, `environmentControl` slots and agreed lifecycle callbacks | No placeholder success; per-chat memory/read/contribute; Dot stop/pause; actual voice consent/cancel/reconnect; screenshot Customize lifecycle |

## Feature coverage and remaining implementation

The stream's original dispositions remain open. F01/F03/F04 conversation presentation uses real existing hooks, including tool and permission/question rendering. F02/F06/F07 navigation is isolated and awaits the shared project/sidebar catalog. F29 delegates existing editor behavior through its real VS Code route. F32 supplies the real session diff inspector; branch selection/unified-split/hunk mutation/commit/push/PR/inline review (F32–F34) require the Projects/execution APIs and coordinator ownership resolution. The parallel plan table assigns Git to Projects while the machine-readable map assigns F32–F34 to Work UI; request an explicit contract/ownership resolution before cross-stream writes.

F45 context suggestions; F51/F53 shared browser sessions and annotations; F56 image generation/editing (image inputs implemented); F57 rich document/spreadsheet/slide/PDF/LaTeX artifact editing/export; F58 interactive artifact preview; F59 Sites lifecycle; F60 maps/custom assistant catalog; F66 optional pets/overlays are **not implemented or accepted by this slice**. Their UI needs real permission-aware service/operation contracts. Existing Docs/VS Code links are capability preservation, not a substitute for these requested deliverables. No original disposition is removed or silently deferred.

## Required verification

1. Focused component/runtime tests and strict dashboard typecheck/lint against the exact integrated source. No worker build/install lease has been issued.
2. Changed-route screenshot comparison at reference viewport/DPI; mobile375/tablet768/desktop1280/wide1920 and200% text scaling; keyboard/focus/screen-reader checks. Empty/loading/error and long projects/chat names must remain usable.
3. Actual authorized session: New chat, model/default/variant, attach image/text/PDF, send, streaming tools/questions/permissions, Stop, errors, lost acknowledgement, history reload and project/runtime switching. No fixture is inference or workflow proof.
4. Verified upstream exact-session toggle and Web-to-Work authoritative refresh. Draft durability across non-Work navigation/reload remains open and must be solved using the coordinator-owned state contract, rather than a new private authority.
5. Integrated native Windows/WSL and Linux/cluster workflows; full retained47-view/20-setting/11-Windows-state matrix, publication/persistence/rollback. Final visual/audio/desktop control belongs only to the coordinator.

Worker goal remains active until the coordinator accepts its scope. This source checkpoint is not full Work acceptance, phase completion or release completion.
