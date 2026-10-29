# Native Work layout follow-on

The coordinator's real NativeWorkDesktop/App no-project fixture exposed two full-width findings strips, dock tabs/drag instructions, split controls, fifteen rail icons and oversized startup explanations. That fixture is not visual acceptance. This follow-on makes the quiet Work canvas and sidebar hierarchy dominant, while preserving the original feature owners.

## Exact base and patch

- Apply after accepted native268962e20bef8c246fce332241c08c00c1fc2317 / original patch1294cbf1b5cf778cae5b08cc306583d8071f93e35d39451510af630af9c60672.
- Follow-on: [native-work-layout.patch](native-work-layout.patch), 40550 bytes.
- SHA256: `0379a12c41d573098663844a55931dc40a15c7c4a4a851c05aee3acd77e41a7c`.
- [Before/after hashes](native-work-layout.json) cover all eight follow-on files, including the newly authorized exact LiveSessionSidebar.tsx path.
- The original ten-file staged index remains frozen. Its exact binary diff byte hash still matches1294cbf1; follow-on edits are unstaged and the new test is untracked in the same native checkout. No add/reset/clean/native commit or hook bypass occurred.
- Actual scoped goal tracker remains blocked. The coordinator explicitly requested this additional bounded source work; this receipt does not invent an active tracker state or claim full acceptance.

## Behavior

Work-default shows four primary rail destinations plus More applications. Every other original application remains a named action in that compact disclosure. Escape closes it and returns focus to its trigger. Original navigation/auth/history guards remain in place. Outside workDefault, the original full rail remains.

Review findings opens the retained original review/scanner components in a bounded overlay. Actual Open findings intents reveal it automatically. The owners stay mounted while the overlay is closed; their original receipts and outcomes remain intact. View layout reveals the original dock tabs/drag controls and split toolbar. Hidden controls are not deleted or replaced with fake operations, and saved pane layout stays authoritative.

The Work sidebar is New chat, Dot, Pinned, Projects and Recents. Dot opens the existing Scheduled feature; it does not claim a newly running proactive agent. An optional Work-only presentation in the original LiveSessionSidebar groups only already returned session rows by actual pinned flags and preserves their returned order within each group. It introduces no request, ledger, fabricated timestamps or new sort authority. The existing ProjectSidebar is mounted once between the two groups with its original catalog, collapse/sort/read-state/create/select controls. Original row controls, archives, pagination and deletion/recovery behavior remain available. Task library, quick access and sidebar status move into explicit secondary disclosures. The default legacy Chats projection remains unchanged.

No-project New chat remains unavailable, with its reason accessible from the disabled sidebar action. Start options contains the explanation and explicit real scratch-project creation/recovery action. The canvas now offers Choose project without a second oversized New-chat row. No projectless private owner is claimed. No-project Work no longer advertises inspector/terminal toggles without a workspace. All existing scratch intent guards remain unchanged.

No mascot asset changed. The broken mascot in the first fixture was the coordinator's publicDir omission; the original private reference and product assets remain protected. No desktop/browser/service/build/inference activity was started by this worker.

## Validation scope

Native unstaged source whitespace check and exact follow-on reverse-apply check with whitespace errors enabled pass. Required blank context markers in raw patch documents are preserved. Before-index source SHA256 and after-working-byte/Git-blob hashes distinguish canonical patch content from platform line endings.

The source now has eleven Work semantic React cases across four suites. Added cases exercise real LiveSessionSidebar pin grouping/server-order preservation/legacy default with GET-only synthetic metadata, retained owner mount when a drawer closes, explicit legacy/Work disclosures and absent workspace controls on the empty canvas. Existing no-project tests now open Start options before choosing the intentional project operation.

These follow-on React/type checks and screenshot comparisons have **not** run in this worker. The earlier eight-case/type/Windows gate receipt covers the accepted original patch, not this refinement. Coordinator request:

```sh
npm run check --workspace=@veyra/web
npm run test --workspace=@veyra/web -- src/features/work-ui/NativeWorkPresentation.test.tsx src/features/work-ui/NativeWorkDesktop.test.tsx src/features/work-ui/NativeWorkNoProjectActions.test.tsx src/features/work-ui/LiveSessionSidebarWork.test.tsx
```

Central real-App fixture comparison, long-content/theme/scaling/keyboard/compact menus and drawer focus, retained original browser/native/runtime gates, genuine private/null-project owner and qualified exact-session Web host remain open. No source fixture is native acceptance. All74 feature dispositions remain retained.

## Storage and regeneration

This uses the existing native checkout and approved physical root. The two native patches are sequential required review inputs, not duplicate full builds. Regenerate tracked follow-on changes with git diff --binary against the frozen staged index, then append the new relative-file git diff --no-index binary patch; validate against the actual working tree. Retain source/hash/review evidence for coordinator integration. No scratch index, source snapshot, dependencies, cache or compiler output was created. Removed paths: none. Removed bytes: 0. No cleanup exception or disk-recovery claim.
