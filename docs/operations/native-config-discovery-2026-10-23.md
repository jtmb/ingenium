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
