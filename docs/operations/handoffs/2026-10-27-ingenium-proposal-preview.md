# Ingenium proposal evidence checkpoint

Continue the full production migration and release goal in the current Codex window. Preserve the original installation, data, credentials, model settings and single-writer fence. Do not develop through OpenCode or create a successor chat.

Application PR #21 merged as `be45d0d5a411f5bac04bc44fdc70c798ba83f192`. The proposal review overlay reads actual API enrichment fields `type` and `contentPreview`, retaining older aliases. Evidence cards show the synthesis `trigger` and clearly label source previews when no authored summaries exist. Every observation ID retains its project-scoped link when enrichment is absent or partial. The regression reproduced four failures before correction; all 21 focused proposal/Skills UI tests and the dashboard typecheck pass.

Chart PR #20 merged as `52f31744b5950b94a38bd443a1fb88c471535b6d`, version 0.1.13. Local exact-source CI attempt `ce898679b47f4c419ecb0755b7f768cf` promoted it to validated, then Flux deployed `docker.io/jtmb92/ingenium@sha256:63495a9e9ae02f636b321db077dd56efbebe53151a345e6cc992bd10456c71af`. Its inspect size is 1,209,309,744 bytes, about 1.21 GB. Full compatibility build, three packaged boundary checks, exact-digest worker probe, all 33 chart tests, full 30-chart/31-release/73-foundation validation, rendered comparison and server dry run passed. The only Deployment changes are init/main image references.

The replacement has one Ready writer with zero restarts. The same retained PVC, native Secrets, mounted model hash and two healthy RW Longhorn replicas are preserved; the original Docker writer remains stopped. Normal authenticated vault unseal and information-only tunnel reconnection restored the three public pages, with private routes still returning 404.

Actual UI review now displays the proposal trigger, three previews, correction types and source links. The activated skill revision2 main/reference files survived replacement: API content/file tree and API-user disk hashes match, and both render in the UI. A separate empty chat used that active skill as explicit reference and correctly handled a new held-out input with zero tools; the reply survives reload. Free Zen returned a quota error for that native request, so the explicitly approved per-response Luna fallback was used. Saved defaults remain Beam Free. Automatic skill discovery is not claimed.

The passive sweep observed all 25 navigation/settings surfaces and retained initial-loading and historical-error observations. That is separate from independent functional acceptance. Remaining work:

- Jobs needs a supported organization-owned native provider connection/service grant and named-agent projection in its isolated runtime, followed by a real Job execution and persistence check. An unchanged baked agent profile copied into a private disposable runtime produced a fresh anonymous Free Zen response; this qualifies a mechanism, not the Job feature.
- Status synthesis detail hardcodes global-default despite the selected project. Establish and repair its truthful scope; verify Usage attribution rather than inventing telemetry.
- Inspect the older owned Chat notice's actual message/part type before changing filtering, and finish the remaining independent controls.

Current feature cleanup removed 1,445,003,264 allocated Linux bytes of generated dependencies, caches, context and typecheck/temp outputs; no Windows disk recovery is claimed. Older integration runtime remains referenced and has not met the 72-hour inactivity gate. Required recovery/source/runtime, unique receipts and the policy-rejected empty checkout remain preserved. Full release acceptance flags stay false until the remaining gates pass.
