# Native runtime configuration discovery

OpenCode 2.0.11 uses `OPENCODE_CONFIG_DIR` as its complete global discovery root
and does not discover the former `/etc/opencode` policy automatically. The
compatibility launcher pointed at an empty runtime directory, leaving saved
configuration, ordinary profiles and Ingenium plugins undiscovered at `/workspace`.
It now selects the projected persistent directory. Both launchers explicitly load
the immutable managed policy. Isolated runtime profiles are projected inside that
runtime's actual discovery root. Credentials and project bindings remain scoped.

The API transport now forwards the selected runtime directory through the native
`x-opencode-directory` header, including catalog requests without a location query.
Unscoped compatibility requests retain their existing default directory. A cold
native location briefly returns an empty agent registry during plugin activation;
the agent catalog now retries that condition with a bounded startup diagnostic.

The broker enforcer previously assumed its agent already existed during plugin
setup. Native configuration is an internal post-plugin and can replace that entry
after external setup. The enforcer now creates a missing entry, reapplies its final
registry transform after plugin activation, and independently denies broker tool
authorization while activation is in progress. Ordinary agents keep their policy.
Persistent projection also removes the retired session-coordinator plugin entry.

In the isolated restored stack, the five Ingenium plugins loaded and the broker
enforcer remained active. A copied project configuration deliberately disabled the
broker and supplied a foreign model, primary mode and permissive tool rules. After
activation, the native catalog contained the protected hidden subagent with no
model override and terminal deny rules. Synthetic discovery files were removed and
both project override fixtures were restored before normal acceptance resumed.

Focused checks passed: 18 configuration tests, 99 API client tests and four
credential/launcher tests. Clean curated-source typechecking passed. Final image build,
ordinary restart acceptance and production adoption are separate remaining gates.
Production was not modified for this investigation. The release goal remains open.

## Real free-provider chat and current event schema

The release image was subsequently adopted through production Compose with all
four named volumes and 13 mount targets preserved. Composite health, dashboard
login, three historical session identities and creation times, encryption/signing
key continuity, and installed MCP memory save/update/read were verified.

At the user's direction, actual inference uses Zen's free `flint-40b-free` model.
The native session returned the exact release canary with a successful outcome
and zero reported cost. Agent model configuration was not changed. The dashboard
continued showing Generating because its adapter recognized older `session.next.*`
events. Captured 2.0.11 events use `session.step.*`, `session.text.*`, ordinal part
identities, envelope creation timestamps, and explicit execution terminal events.

The adapter now accepts both shapes, keeps reasoning and text ordinals separate,
and translates current execution completion, interruption and failure. Focused
contract tests and API typechecking passed. Rebuilt-image adoption, live browser
stream completion, authenticated reload and final ordinary restart acceptance
remain separate gates until verified.

## Cold provider registry follow-up

The rebuilt stream adapter passed real Zen browser send/receive/completion,
authenticated reload, and the mobile overflow check without request errors.
The first cold browser load also exposed a separate catalog race: provider and
model snapshots can be empty while native location plugins are activating.
The API now retries both snapshots together with bounded backoff, reports a
startup diagnostic if they never settle, and preserves explicitly disabled
providers. It does not replace models, enable disabled providers, or change
defaults. Five new client regressions and API typechecking passed. Final image
adoption and cold restart acceptance remain due for this catalog follow-up.

## Embedded workspace readiness follow-up

The catalog image passed real free-Zen Beam chat, authenticated reload and a
normal Compose restart without changing model configuration. The passive page
sweep then found the embedded OpenCode workspace incorrectly unavailable: its
readiness probe still requested the native root without the HTTP Basic identity
now required by V2. The CLI readiness probe likewise bypassed ttyd's gateway
identity. Web readiness now reuses the protected native API credential against
`/api/info`; CLI readiness uses the loopback-only gateway health route. Credentials
are not sent to CLI or VS Code, redirects are not followed, and missing native
credentials fail closed. Focused regression checks and rebuilt-image acceptance
remain separate gates for this follow-up.

The affected runtime suite also retained two cancelled coordination expectations:
coordination scopes on a new capability and successful renewal through the removed
peer-registration API. Expected scopes now match the retired coordinator policy;
activity authentication, binding and inactive-runtime denials remain covered.
The previous assertions remain in Git history at `445eda062cea4eff68acf20b30587ee6c5b296e2`.


## Final runtime release acceptance - 2026-10-23

The final catalog/stream image passed a fresh real free-Zen reply and its
persistence across an ordinary Compose restart, authenticated reload, desktop/mobile review and a
24-route browser sweep without unexpected request errors. Configured models are unchanged.
Installed memory save/update/restart/read/forget, three historical sessions and
three encryption/signing keys passed preservation checks. Composite health and
all 13 mounts passed. The owned rehearsal is stopped with its data retained.

Source/runtime provenance, remaining moderate advisories, retained failure and
rollback evidence, and the PR #4 publication record are documented in
[release-acceptance-2026-10-23.md](release-acceptance-2026-10-23.md).
Earlier pending statements above are historical checkpoints superseded here.
Multichat orchestration and coordinated recovery remain cancelled.
Zen's extra final post-restart inference attempt hit its free quota; no successful
new reply is claimed for that attempt. Earlier catalog-image fresh post-restart
inference passed with identical chat/native/frontend source inputs.
