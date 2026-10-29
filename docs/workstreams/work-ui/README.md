# Veyra Work UI stream

Status: source implementation for coordinator integration; final acceptance remains open.

Work is available at `/work?project=<name>&runtime=<id>&session=<engine-session-id>` under the existing authenticated Dashboard providers. It uses the existing OpenCode client, session catalog and streaming controller. It creates no database, transcript store, scheduler or runtime authority. `/chat` and upstream OpenCode sources are unchanged.

The shell follows the approved Work reference (`8ae60026e2c79e07302a576d04d5c731431024c83b2329bdf6c76ff0e57dab08`, 2559×1439): 52px application rail, adjustable conversation sidebar (468px preferred reference width; 256/360/468px keyboard and pointer choices, constrained by viewport), warm dark canvas, quiet header and centered 740px bottom composer. Narrow viewports start with the sidebar collapsed and retain its toggle. Geometry remains subject to screenshot/DPI comparison. It uses the existing blue Veyra mascot. Reference account/project/chat text is not copied. Tailwind classes are isolated to these components; global CSS is unchanged.

## Usage and authority

- Start a chat explicitly with **New chat**, or select a catalog conversation. Opening Work alone does not create a session or invoke inference.
- An explicit project/runtime mismatch stops before transcript hooks mount. An unknown session never falls back to another conversation. Browser Back/Forward follows the scoped URL, independent of the legacy session hook's local selection.
- Drafts are in-memory and scoped by installation surface, authenticated user, organization, project, runtime, workspace and session. Text, attachment references, explicit skill IDs and model/reasoning fields have a single draft shape. Presentation switching keeps the Work subtree mounted. A pre-session draft transfers only after New chat returns a confirmed session identity. Drafts are deliberately not written to shared localStorage or a second transcript store; a full route departure/reload does not yet have durable draft recovery.
- Send waits for the exact session's history and a configured model. Existing sessions retain `OpenCodeSession.model` provider/model/optional variant; absence of native model metadata requires explicit selection rather than substituting installation defaults. New sessions inherit the pre-session draft initialized from chat-config defaults; Work never calls `saveSelection` or writes defaults. Only variants supplied in supported model metadata appear as choices in the reusable composer; a retained native variant has a read-only label. The current base's chat-config has no variant catalog, so this compatibility adapter presents no reasoning selector. Coordinator's installation `chat_defaults` changes must be integrated before default/variant acceptance.
- Enter sends; Shift+Enter and IME composition retain the input. Sending/attachment reads use a synchronous lock. Failed/unconfirmed sends retain the original draft and are never automatically retried. Streaming has an explicit Stop action. Existing permission/question controls retain their native server handlers.
- Attach up to five PNG/JPEG/WebP/GIF/PDF/plain-text/Markdown files, each at most 10 MiB. Unsupported/unknown MIME types fail before reads. FileReader failures preserve the draft. Files remain browser memory and are sent as existing OpenCode file parts; there is no filesystem upload authority or hidden disk copy. Model support for each attachment type still requires runtime qualification.
- **Review changes** reads the selected session's existing diff endpoint and scopes the result to that session. It supports native patch-format unified/split/source views and legacy before/after text. Hunk line/count validation rejects incomplete text patches into an original-source view. Binary/unrecognized payloads remain available, and source text is never executed. This read-only view does not claim Git mutation authority. Existing file/code editor and terminal views remain reachable through the feature directory.
- The application rail/feature directory links real existing Tasks, VS Code, terminal, Docs, Plugins, Skills, Agents, Context, Jobs and Settings routes. These links preserve existing authorization, but route departure currently unmounts Work; use the in-place Web toggle when preserving a draft is required.

## Web presentation

Web lazy-mounts `WorkWebFrame` after first selection and keeps its same-session iframe mounted thereafter. It reuses the existing `useRuntimeLaunch` ticket/capability/origin checks, then constructs the pinned OpenCode2.0.11 session route on that authorized public origin. No session selected means no empty upstream launch. Timeout/connection failures retain Work and require an explicit connection retry. No upstream DOM, CSS, source, branding, CSP or native IPC restrictions are changed.

The route protocol was checked against version-tagged upstream source; see [web protocol evidence](web-protocol.md). Browser Work/Web switches retain composer/attachments and exact selected identity. Returning to Work reopens its existing controller on that same session, using its normal authoritative history and native busy recovery. Sends stay blocked during rehydration or a history error, including when the existing hook reports `sessionReady` after a failed load. Unconfirmed submissions retain their scoped originals and notices without replay. Exact deployed-version, gateway, cross-view history/tool/approval and upstream draft behavior remain **runtime acceptance gates**; an iframe load is not proof that a session rendered correctly.

## Source and tests

- `services/ingenium-dashboard/src/app/work/`: server route, loading and route error boundary.
- `services/ingenium-dashboard/src/app/components/veyra-work/`: shell, composer, state and existing-runtime consumer adapter.
- `services/ingenium-dashboard/tests/veyra-work-components.test.tsx`: retained mount/draft behavior, search/identity, send gating, IME and Stop.
- `services/ingenium-dashboard/tests/veyra-work-runtime.test.tsx`: workspace denial, unavailable session, URL/history drafts, Web fallback and original failed send retention.
- `tests/ingenium-dashboard/veyra-work-state.test.mjs`: dependency-free scope/send/attachment guard behavior.
- `tests/ingenium-dashboard/veyra-work-web.test.mjs`: pinned exact-session gateway URL construction and rejection paths.
- `tests/ingenium-dashboard/veyra-work-diff.test.mjs`: format preservation, hunk validation and split alignment.
- `services/ingenium-dashboard/tests/veyra-work-web-frame.test.tsx` and `veyra-work-changes.test.tsx`: no empty launch, stable frame, explicit retry, code safety, view modes and invalid/binary witnesses.

Run the dependency-free check from the owned checkout with task-scoped `TEMP`, `TMP`, `TMPDIR`:

```sh
node --experimental-strip-types --test tests/ingenium-dashboard/veyra-work-*.test.mjs
```

Coordinator schedules existing-lockfile tooling (no install/tree copy) to run both component suites, dashboard TypeScript with `--noEmit --incremental false`, and focused lint on new paths. Build/runtime/visual evidence is a separate class from these source checks.

## Storage reconciliation

Owner: Work UI session `01a18934-d937-7813-8c48-5ae85aad4f18`. Existing output root: `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`, C-backed Ubuntu VHDX paired with the already approved native C root. New files stay inside the assigned checkout and `veyra-phase-1/coordination/work-ui`. Source growth is below the 64 MiB allowance. No dependency tree, cache, compiler output, build, download, runtime or model was created. Tests write TAP to the tool output only.

Retain source/tests/docs for coordinator review and regeneration, plus one ownership receipt and one current status receipt for integration tracking. No bulk output exists to delete. Removed paths: none; removed bytes: 0. Protected baseline research, locks, original screenshots, data, models, credentials and prior cleanup refusals remain unchanged. There is no Linux filesystem or Windows disk-recovery claim.
