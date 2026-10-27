# OpenCode Goal Plugin server

This directory contains the unchanged server entrypoint of
`@prevalentware/opencode-goal-plugin@0.1.67`, the exact version configured in
[jtmb/computer-use](https://github.com/jtmb/computer-use).
`provenance.json` records the package integrity and file hash; LICENSE is retained.

The server uses the existing Zod dependency and the separately aliased Effect 3
runtime. Keeping the server entrypoint avoids installing unused TUI peer packages
into the web dashboard image. OpenCode commands, goal tools, persistent history,
plans and automatic continuation use upstream implementation unchanged.
Ingenium's wrapper excludes its Chat and protected broker agents from goal tools,
commands, reminders, compaction and autonomous continuation. No model setting is
changed. The OpenCode web interface exposes `/goal`, `/pause_goal`, `/resume_goal`;
this integration does not install the optional standalone terminal sidebar.

To update: download the pinned npm tarball, verify its SHA-512 integrity, copy
`dist/server.js` verbatim to `server.mjs` and LICENSE, update provenance, then run
`node --test packages/ingenium-extension/goal-plugin-scope.test.mjs`, the plugin
source-closure check and the native OpenCode plugin smoke test.
