# Ingenium release acceptance - 2026-10-23

Final runtime acceptance passed on the compatibility deployment. Publication is
tracked by [PR #4](https://github.com/jtmb/ingenium/pull/4); its merged state and
merge commit are the publication record. All development remained in the same
Codex chat. OpenCode was exercised only as the product runtime.

## Accepted fixes and scope

Native global and project discovery now use the correct configuration roots and
directory headers. The protected broker policy survives native plugin activation
and rejects permissive project overrides. The catalog waits for both native
provider and model registries to settle after cold startup. Streaming accepts
current OpenCode execution, text and reasoning events as well as the older schema.
Saved chat reconnects retain exact private identity after native title changes.
Configured agent model references, variants and defaults are unchanged.

Multichat orchestration, coordinated recovery, R21, simultaneous A/B/C and
replacement-parent attestation were cancelled by the user. Historical evidence
and sessions are retained; those features are not release gates.

## Evidence

| Boundary | Result |
|---|---|
| Focused source regressions | 104 native-client tests, 60 native-stream contract tests, 54 provider/catalog tests and 31 runtime-route tests passed; affected API typechecking passed. Earlier curated core, extension and launcher checks remain recorded in the release plan. |
| Dependency audit | Zero critical, zero high, 21 moderate production findings; no claim that moderate findings are resolved. |
| Installed policy | Protected native configuration and trusted-core checks passed on the actual final image. An earlier candidate's startup timeout and unchanged successful rerun are retained privately. |
| Production adoption | Healthy final image, same four named volumes and all 13 mount targets; all published ports bound to loopback. |
| Real browser chat | A fresh exact reply through Zen `opencode/beam-free` passed on the final image, including live completion, authenticated reload and desktop/mobile review. That reply remained readable after ordinary Compose restart. The prior catalog image passed fresh inference before and after restart; chat, native-binary and frontend source inputs are unchanged by the later readiness fix. |
| Installed memory | Synthetic item saved, updated, retained through image replacement and ordinary restart, reread through installed MCP, then forgotten and confirmed unreadable. No user memory was removed. |
| Historical sessions | Three pre-existing native session IDs, creation times and directories preserved; native migration completed. |
| Key continuity | Auth encryption, backup signing and email encryption keys exactly matched the preserved installation and remained unchanged after restart. |
| Browser review | All 24 sidebar routes loaded without unexpected HTTP/page errors, account failures or horizontal overflow. Actual desktop/mobile chat and route screenshots were inspected. Native workspace and VS Code workbench readiness were verified. Known optional upstream requests are recorded below. |
| Learning controls | Credential step-up appeared; cancellation passed and issued no automation request. Background learning was not enabled for the test. |
| Preservation | Verified source/data/config/session archives, migration rehearsal, original and previous release images retained. Owned restore rehearsal stopped; its data retained. Unrelated dirty work excluded from publication. |

Actual inference used the user-selected free Zen provider. Flint's upstream
endpoint was unavailable during final acceptance; another enabled zero-cost
model already in the native catalog was selected for the test. No configured
model mapping or provider definition changed. Expired OpenAI login renewal was
not required and no successful OpenAI inference is claimed. An expired dashboard
test session was renewed using the existing local installation credentials.

The extra fresh-inference attempt after the final restart hit Zen's free usage
limit. This is recorded as an external constraint, not a successful reply.
No paid inference, alternate identity, quota bypass or model configuration change
was used. Final-image real inference, stored-reply restart persistence and the
earlier fresh post-restart inference on identical chat code are separate evidence.

The embedded workspace readiness follow-up authenticates native Web probes with
the existing protected credential and sends CLI probes through ttyd's loopback
gateway health route. Missing credentials fail closed; native credentials are
not sent to CLI or VS Code. Runtime tests retain authentication/binding denials
while retiring the cancelled coordination-peer renewal assumptions.

VS Code's actual workbench loaded. Its browser trace retained two missing VSDA
asset requests and an unavailable Open VSX Copilot Chat listing as known optional
upstream requests. The [code-server maintainer explanation](https://github.com/coder/code-server/discussions/6997)
and [marketplace policy](https://coder.com/docs/code-server/FAQ#why-cant-code-server-use-microsofts-extension-marketplace)
describe these open-source distribution boundaries. Only those exact 404 paths
are classified separately; other HTTP errors and page errors still fail review.
Embedded applications are checked by their loaded DOM because their ongoing
connections do not provide a reliable network-idle milestone.

## Reproducible image identity

- Runtime source revision: `46af770c13f8080b9e7497d0fc154db35eef4def`.
- Curated build source SHA-256: `53c0da790a89b7433f930182658acb554988d45cb78b219316e73548e2185f5c`.
- Image: `ingenium-ingenium:release-20261023-53c0da790a89`.
- Image ID: `sha256:621d357c605d4f46b40d3bcf6c7588a8fc87217a5a30973b812aaadd45dcdc02`.

Main was integrated in `445eda062cea4eff68acf20b30587ee6c5b296e2`. Eleven retired files were preserved
byte for byte under `docs/reference/archive/main-before-native-v2-2026-10-23/`,
outside active discovery. That commit and this acceptance ledger change only
documentation/reference material. Runtime code, active resources and build
instructions match the image source revision; the image is labelled with its
actual build revision rather than a later documentation commit.

Compose initially timed out while replacing the previous container. The resumed
switch preserved every mount. Heavy machine paging was observed during startup/health
timeouts; the completed owned rehearsal was stopped and unused filesystem cache
released. The final cold image exceeded its six-minute startup observation and
needed an operator retry of its one-shot credential bootstrap after the API was
ready. It reached composite health after 769 seconds.
The subsequent ordinary restart passed without manual assistance, with readiness
after 159.0 seconds. Original failure evidence was retained, and
existing health probes, assertions and timeout budgets were not weakened for
acceptance. No fast-start or resource-capacity guarantee is claimed.

The free provider's availability and capacity remain external service behavior.
Rollback images and preserved original data remain available; no broad cleanup,
volume removal or unrelated application shutdown was performed.
