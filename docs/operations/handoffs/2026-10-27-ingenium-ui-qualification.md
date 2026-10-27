# Ingenium release UI qualification — 2026-10-27

The full production migration goal remains active. Continue in the same coordinating Codex window; do not develop through OpenCode or create a successor chat. Preserve the existing model/provider/default configuration.

## Changes

Service Status previously queried synthesis with the literal project name instead of its database ID and ignored the selected project. It could show zero observations despite an existing synthesis history. Synthesis and task activity now use the selected project; installation-wide services are explicitly labeled. Scheduler cadence uses the same existing active-global setting as the scheduler. Processing timestamps are labeled as observation activity, with no invented next-run time or stuck-scheduler diagnosis. Documentation and task detail cards show their own statistics.

A dashboard kept open longer than the ten-minute CSRF grant lifetime could read successfully but fail writes until reloaded. The shared browser client now renews a grant and replays once only after the API's explicit pre-handler 403 CSRF_REJECTED. It preserves the request body, canonical dashboard marker and same-origin credentials. Sign-in requests, streamed bodies, unrelated authorization/proxy errors and repeated rejections are not replayed. Server authentication, origin validation, CSRF verification and step-up remain intact.

Native system messages, including Code Mode catalog instructions, previously appeared in the Chat transcript. The transcript now omits messages with the native system role, keeping the underlying history intact. Identical text in actual user or assistant messages remains visible.

## Validation

- Status/activity/cadence, service detail and dashboard API regressions: 46 passed.
- Status, overlays, Usage, authentication, canonical client and proxy checks: 89 passed.
- Chat rendering, scroll, forms, task capture and stream/history hook regressions: 91 passed.
- API and dashboard TypeScript checks passed.
- The original bugs were reproduced before changes. An initial proxy fixture check was affected by the operator's restrictive umask; the intended unsafe-file fixture passed under the suite's ordinary creation mask. Runtime permissions were not changed.
- Real production Usage retains its existing global-default attribution, with 33 requests and a fresh sync. Provider/model/status filtering showed six successful OpenAI Luna step-finish events. The ingenium project's threshold save, restore to disabled and independent attention evaluation were exercised. No usage mapping or saved model changed.

## Production acceptance

Chart 0.1.16 is Ready through the existing main -> singleton local CI -> validated -> Flux path. The final charts revision is a568d53303ec0b2b3dc7ae45deb56139a1a9aa7e; the deployed application remains source 0f4e79a7d7962441b6190626c5d9a85d1107c283, snapshot 10652dad3ea42fb5c43518f46b3cb56d8940475bda7d2fe7e46595fc4ad3bd59 and immutable image sha256:712f40a5177079f3d7aab020632ef993ffb0775f2cb17355d77e9e81d7c31a66. Image content is 1,209,333,408 bytes (about 1.21 GB); unpacked storage, persistent state, replicas and developer artifacts are separate measurements.

The live installation has one Ready Pod with zero restarts, unchanged native Secret/PVC/model identities and two healthy RW Longhorn replicas. The original Docker writer remains stopped and retained. Final acceptance changed no application Pod spec or rendered resource set. Authenticated localhost dashboard/OAuth forwards remain supervised; the optional LAN route stays absent. Public information remains limited to ingenium-info.jtmb.cc, with public pages200 and private routes404 under normal TLS verification. There are no in-app production migration controls.

Deployed independent checks verify selected-project synthesis counts (Ingenium193 processed/0 pending/126 traits; global-default9/0/10), actual60-minute cadence and independent Docs/Tasks details. Chat hides the native system-role catalog notice while preserving its raw record. Logs source/text/severity filters, pause/resume, empty wording and buffered counters work. Usage attribution and provider/model/status filters use real events; CSV content was verified through the authenticated export endpoint. A browser left open beyond the ten-minute grant lifetime saved thresholds successfully, restored them to Disabled, and passed both evaluation controls without a reload or step-up during the expiry window.

The disabled per-job free-Beam grant, successful structured response run and redacted logs survived replacement. A separate new empty Chat session returned the exact approved Luna response after free Zen returned its real usage-limit error; the response survived reload and Beam Free remained the saved default. Existing credentials, provider/model mappings and variants were not changed. Earlier full synthesis proposal/approval/activation/held-out inference and skill edit checks passed; activated skill revision2 and its main/reference content remain present on the final image. Real Gmail self-send/receive, inbox reading, native Goal outside Chat, Tasks/Docs changes, VS Code file persistence and signed encrypted backup download/readback were independently verified. The persisted completed native Goal was read again after the final replacement. No live backup restore was executed; coordinated cold restoration and all84 SQLite checks passed before cutover.

All35 chart/bootstrap tests, complete30-chart/31-release/73-foundation validation, credential scanning, exact rendered-spec comparison and server dry run passed. The first acceptance publication attempt was correctly withheld because its exact-count gate still expected33 tests; a reviewed correction requires exactly35 in check/publish/observation, and the new singleton attempt passed and published before Flux upgraded. The unchanged final lockfile audit reports zero vulnerabilities at every severity, including zero moderate advisories.

## Output reconciliation

Finished host dependencies, compiler outputs, npm caches and source contexts were removed after regeneration and fresh process/container/mount checks. Thirty-one redundant local release image copies were retired without removing published registry artifacts. Minimal unique source deltas and exact cleanup receipts remain private. Original recovery archives, active private access, the original/rehearsal container consumers, unqualified historical images, shared cache records without complete ownership/reference proof and the previously policy-rejected empty directory remain protected and explicitly inventoried. Linux allocation recovery is reported separately from measured Windows free space.

The reusable ingenium-kubernetes-deploy skill documents cold transfer, bounded bootstrap ownership, private access, full application acceptance and optional routing. All development and release work stayed in the coordinating Codex window; OpenCode was used only for authorized runtime response/Goal verification.
