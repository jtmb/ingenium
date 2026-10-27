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

## Remaining acceptance

Publish and qualify the exact reviewed source/image through the existing charts/local CI/validated/Flux path. Verify selected-project Status counts and independent Docs/Tasks detail statistics in the deployed UI. Verify the existing disabled free-Zen Job grant, successful run and redacted logs survive the replacement. Exercise a write after the new browser client's CSRF grant naturally expires. Finish independent UI checks and the full release matrix before promoting final application acceptance.

Continue bounded output reconciliation before another image build. Historical local image copies are being removed only after verified registry or complete Git/source reconstruction and fresh consumer checks. Preserve original/rehearsal container images, active runtime, unique source deltas, original data and required recovery copies. Record Linux recovery separately from Windows free space.
