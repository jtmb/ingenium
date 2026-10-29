# Coordinator integration requests and acceptance

See the bounded [integrated closure review](integrated-closure-review.md) for observed source evidence, the build-input reproducibility finding and remaining candidate gates. No shared-path edits are included. Review and integrate these modules in dependency order without changing root manifests or copying dependency trees.

| Request | Coordinator action | Required evidence |
| --- | --- | --- |
| Browser transport | Adapt the frozen ProjectRef/ExecutionBinding and authenticated capability DTO to `planBrowserOperation`; provide the qualified existing native/paired/remote transport | Denied cross-account/project/runtime/environment/tab, expiration, cancellation before/after dispatch, selected-tab DOM/screenshot and native selected-app cancellation |
| Operations compatibility | Feed actual existing API/verifier receipts into `operationsCompatibility` | All 18 checks on each supported platform; no new writer or scheduler |
| Native projection | Integrate the native input preflight before generating any approved frontend config override | Exact configured icons/config/Cargo/build inputs and separate reviewed effective build-config hash |
| Exact source | Capture clean application and native identities after integrating every stream and preserving installation Chat defaults | Raw source inventory and pinned external dependency/lock hashes before/after the build |
| Windows release | Use the existing storage-guarded desktop builder with an exact reviewed integrated frontend and isolated candidate | Archive hash, notices, truthful signing/update status, portable/installer rollback, lifecycle/tray/native/WSL/terminal/reconnect, unchanged installed engine/settings/models |
| Linux release | Use the existing image build/publisher and Helm/Flux owner with no custom engine/model closure | Immutable image revision/digest, ingress/auth, original PVC/Secret identities, restart persistence, isolated restore and rollback |
| Release evidence | Feed independently reviewed immutable candidate-bound receipt descriptors and their canonical evidence root into `qualify.mjs` | All platform gates plus original and newly approved functional/visual acceptance |

## Build queue requests

No worker build lease is requested. The following stages belong in the coordinator's shared queue after source integration and fresh peak accounting:

1. Run the release CPU suites against the integrated source (dependency-free, no generated directories, under 1 MiB receipt growth). Also run existing focused native Tauri/frontend/storage guard suites using their declared test roots and leases where needed.
2. Run `node tools/veyra-release/source-manifest.mjs "$APP_SOURCE" "$APP_REVISION"` with output redirected into the existing private evidence directory. Expected output is a small per-file JSON manifest, no source snapshot or dependencies. Preserve the commit/tree/source hash in the candidate receipt. Native Git remains Windows-only, so capture its revision/status through the prescribed command-scoped safe.directory path and hash its reviewed packaging inputs separately.
3. In the native source, run `node tools/veyra-release/tauri-inputs.mjs "$NATIVE_SOURCE" "$PROJECTED_NATIVE_SOURCE"` before approved generated config overrides. Then retain the effective override hash, existing frontendDirectorySetting/asset-key checks, exact frontend source/hash, Cargo.lock/npm lock hashes, source toolchain pins and external brain lock. This is a prerequisite, not a replacement for existing storage/build checks.
4. Schedule the existing native guarded build and exact-source Linux image stage separately after eligible host build outputs have been retired. Actual growth must be inventoried by the coordinator; this worker has not measured or leased those stages and supplies no invented estimate. Preserve the current usable package/image and required rollback consumer until replacement acceptance.
5. Inspect the isolated staged package with the reviewed payload allowlist. Record archive/image transfer bytes, unpacked bytes, final artifact hash/digest and notices separately. Collect real platform/workflow/visual/persistence/rollback receipts and evaluate the release report.

## Remaining release gates

The worker does not close launch, tray/single-instance/exit, native/WSL tasks/terminal, actual browser attachment/selected-tab controls, native selected-app capture/actions/cancel, real mail/provider/Vault accounts, backup restore, new visual acceptance, microphone/live voice, Kubernetes rollout/data preservation/restart/rollback, signing/update or benchmark gates. The frozen-suite/effective-context/provenance/performance/context/vision checks remain independent. The worker never reads private holdouts or starts model/GPU qualification.

The coordinator retains the active full release goal and architecture approval gate. Worker readiness means these scoped modules and tests can be reviewed and integrated; it is not the full Windows/Linux release.
