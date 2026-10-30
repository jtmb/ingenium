# Native Work narrow-width refinement

The coordinator's actual 900×700 Work fixture showed the session selector overflowing into Access, dense environment/model/action fields, and attention content competing with the conversation/composer height. This proposal fixes wrapping and containment without hiding warnings or changing a controller.

## Exact baseline and delta

- Immutable coordinator staged tree: `268acab8c5dcf14ab188ecd8fdcbb21c9316179b`, on native268962e20bef8c246fce332241c08c00c1fc2317.
- [native-work-narrow.patch](native-work-narrow.patch): 8515 bytes.
- SHA256: `2e88020896a0491f2d1b5a8b390688b4467d4eb202ca483fffabee4d974c8e25`.
- [Before/after source hashes](native-work-narrow.json) identify the two native paths. The existing Workbench, presentation helper and presentation tests are entirely unchanged from the exact staged tree, not just their operational regions.
- The worker's original frozen staged-index patch remains1294cbf1b5cf778cae5b08cc306583d8071f93e35d39451510af630af9c60672. All prior sequential source artifacts remain unchanged and recoverable.

Only native-work.css and the new passive native-work-reflow.browser.mjs assertion source change. No App/Workbench JSX, handler, effect, timing, transport, storage, admission, engine/model/profile, Voice or Web authority changes. Every new style explicitly requires the native-work-default ancestor, preserving rendering outside Work-default.

## Layout behavior

Session and Access field groups have usable wrapping bases and zero intrinsic minimum width. The session select shares available space with its fixed icon rather than overflowing its field. Access notes wrap on their own line. Environment/model selectors retain visible labels and bounded widths even when the viewport is compact; project/session crumbs and action labels wrap rather than overlap.

Current engine state and original error/recovery/permission controls wrap with their actual content. No attention state is filtered or treated as readiness. Expanded Conversation settings remain scrollable, the fixed message minimum no longer pushes the bottom controls out of the chat, and excess attention content can scroll in the actual chat region. The composer retains its intrinsic height. At high text scale this permits scrolling rather than clipping or discarding controls; it does not promise that all attention content fits in one frame.

## Source checks and central assertions

The browser assertion module passes the existing Node syntax check with task-scoped temporary paths. The exact patch passes reverse-apply checking in the worker and read-only git apply --check --whitespace=error-all against the actual coordinator worktree. Neither check modifies an index or root source. The regeneration script also proves all three existing owner/helper/test files match the immutable root tree and verifies the frozen worker staged-index byte hash.

No browser, build, service or operational test ran in this worker. Actual layout/100–200% acceptance remains unproven until the coordinator runs the real-App fixture. The passive assertions are source supplied for its existing harness:

```js
// After the fixture sets width/text scale and opens Conversation settings:
await assertNativeWorkReflow(page);
// Supply exact original labels for the fixture's current attention state:
await assertNativeAttentionReachable(page, requiredOriginalActionLabels);
```

assertNativeWorkReflow measures the actual visible toolbar/session field groups and child controls, rejects overlap/inline overflow, checks the four real labelled selects, and rejects an overflowing but unscrollable chat viewport. assertNativeAttentionReachable checks the fixture's original action labels for unique visibility and absence of inert ancestors. Neither assertion navigates, clicks, focuses, launches a browser, writes data or requires a control to be enabled. They do not infer service or engine readiness.

Requested central cases: 900×700 at100%,150%,200% text scale/zoom as applicable, long project/model/access labels, ordinary and attention/pending states, selected-session fields, stop/recovery controls, and a wide reference regression. Preserve effect counters and original actor/service/owner fixture fences. Fresh types, semantic and native gate work remain central. Existing25-case/five-browser milestone evidence qualifies the earlier source only.

## Reproduction and reconciliation

[native-narrow-delta.py](native-narrow-delta.py) reads the immutable Git tree and existing worker source in memory, then writes only this patch and small manifest. Run it with the existing native Linux checkout and existing Windows Git executable as arguments. It creates no checkout, index copy or full source snapshot.

Same approved task root/physical volume and existing writer checkout. Actual scoped goal tracker remains blocked and is recorded honestly despite the coordinator's explicit new source request. Native source is frozen for central checks after delivery. No native staging/commit, hook bypass, dependency install/copy, cache/build, desktop/browser/device/model/service operation or bulk artifact was created. Required source/tests/patch/hash/recipe notes are retained for the coordinator's current integration and acceptance consumer. Removed paths: none; removed bytes: 0. All originals and unfinished release gates remain protected.
