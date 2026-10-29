# Integrated packaging closure review

Review evidence: 2026-10-29, coordinator application HEAD `09f895cfb7f013476efd43bcf87ace331a670ebe` plus its then-uncommitted API build/materializer and core migration changes. This identifies an observed source state; it is not an immutable release candidate. Re-run the checks after the coordinator freezes the integrated revision.

## Confirmed source closure

The read-only `node services/ingenium-api/scripts/copy-domain-runtime.mjs --check` succeeded with 25 planned files. No materialization, output copy, full build, runtime import, model or desktop action was performed by the packaging reviewer.

The materializer enumerates the declared domain/shared MJS roots, rejects undeclared static dependencies and rewrites their emitted relative imports into the API distribution. The Dockerfile carries API `dist` and its package metadata into the runtime image. `.dockerignore` excludes host `dist`, `node_modules`, `target` and related generated trees, so those host outputs do not satisfy the image build accidentally. These are source-level observations; actual image import/startup remains a separate gate.

Migrations 122-124 are present and referenced by `applyVeyraDomainMigrations` from the existing core DB migration path. Core packaging copies `data` into `dist/data`, and the Dockerfile additionally carries the original migration directory into the image. No missing migration-copy path was observed. The coordinator reported additive migration tests on the core wrapper; this reviewer did not run database migration or rollback tests. Existing data, Secrets, models and rollback sources were not accessed or mutated.

## Build-input reproducibility finding

The observed Dockerfile used mutable `node:22-slim` references for builder/runtime stages and unfrozen apt indexes. A source revision and npm lock alone therefore cannot reconstruct the exact historical OS/toolchain closure. This is a pre-existing release limitation, not an observed domain-import failure.

The coordinator acknowledged this finding and will pin the observed base digests and record the actual OS/toolchain package closure. That action remains to be verified against the frozen build inputs. Record builder/runtime image digests, Node/npm/compiler versions, package lock hashes and observed OS package versions with the candidate. Preserve or qualify an immutable package recipe before claiming byte-for-byte rebuilding; observed package inventories alone do not freeze mutable apt repositories.

## Native checkpoint dependency

The native source-only patch remains subject to its existing registered-root pre-commit gate. Follow the native sidecar guide's environment/receipt procedure. A source-only gate pass does not establish Windows launch, lifecycle, embedded-frontend, native/WSL, browser, signing/update or rollback acceptance. Never bypass the hook or register a different output drive to obtain a commit.

## Evidence and reporting

The packaging worker's focused source/CPU suites and exact worker-source inventory are separate from the integrated source check above. Do not rebind worker receipts to a different integrated revision or built artifact. Candidate qualification requires new exact source/native/artifact identities and verified receipt files.

Report a newly discovered blocker directly to the coordinator immediately and retain it in the owned status receipt. Preserve the first failure and unknown effects; do not substitute repeated unchanged audits for the report. The coordinator owns responses, resource leases, builds, shared wiring, deployment and final platform acceptance. No additional worker, checkout, dependency install, output copy or desktop control is authorized by this review.
