# Canonical hosted governance proposal

This is a docs-only source proposal for Root integration, not an installed migration or a qualified hosted/native runtime. Only this directory is changed. `contract-v1.md`, `wire-v1.ts` and `canonical-vectors.json` freeze the HTTP envelopes and exact original hashing for the Native owner.

`canonical-owner.patch` proposes 14 canonical files, including SQL125. `preimages.json` names the frozen integration commit and every old/new hash. Root must compare exact current preimages and review drift before applying; it must not blindly apply this proposal to a newer integration tree. SQL126 belongs to the separate Native ledger owner.

The engine admits a unique operation durably, then uses the existing single Core writer in an immediate transaction to recheck actual session/principal, mapping, current target/source permissions, all maintenance locks, exact reviewed identities/revisions and proposal body token. Domain SQL effects and terminal receipt commit together. Existing filesystem projections are not atomic with SQLite: an unexpected helper/projection failure rolls SQL back, retains unknown admission and never automatically replays. Read-only recovery does not submit effects.

Private cookies, CSRF and target/source lock tokens remain headers and existing middleware authority. They are absent from originals, hashes and durable receipts. Existing auth and CSRF execute again at effect authorization. Actual reviewer identity comes from that session. Enriched source UUID is returned only after source read permission. The portable patch adds submit and strict opaque proposalHash/currentTarget/currentSource metadata.

Root must inject its verified private enrollment/current-native-owner resolver. Missing injection returns 503 for enrollment/current mapping; body native IDs and renderer metadata cannot replace it. The proposal does not expose synthesis-run or synthesis-models: the actual signed-in user and same ready runtime adapter remain required. Existing provider defaults and services are untouched.

Regenerate using Node with built-in SQLite and type stripping; no install or compilation:

```sh
export NODE_DISABLE_COMPILE_CACHE=1
export TEMP="$OWNED_COORDINATION_ROOT" TMP="$OWNED_COORDINATION_ROOT" TMPDIR="$OWNED_COORDINATION_ROOT"
export HOSTED_GOVERNANCE_TEST_ROOT="$OWNED_COORDINATION_ROOT/hosted-governance-fixtures"
node docs/workstreams/rust-api/hosted-governance/prepare-proposal.mjs "$EXISTING_INTEGRATION_CHECKOUT"
node --experimental-strip-types docs/workstreams/rust-api/hosted-governance/generate-vectors.mjs
node --experimental-strip-types --test docs/workstreams/rust-api/hosted-governance/tests/hosted-governance.test.mjs
```

Validation: Linux Node22.23.1 passes 20/20, including actual two-connection SQLite contention; Windows Node24.18.0 passes the 19 in-memory cases. Windows file-backed test previously failed at cleanup with EBUSY, so its zero-byte `two-creators-30856.sqlite` remains protected at the declared coordination root. It was not retried through another tool or path. No Windows file-backed acceptance is claimed.

These tests execute the proposed engine and SQL125 against real isolated SQLite, with fixture authentication/domain/projection ports. They do not execute the production Express middleware or Core domain helpers. Root still owns strict integrated typechecking, actual auth/CSRF/mapping/projection tests, migration review, Native journals, UI/runtime acceptance, and deployment.

All test scratch uses the predeclared C-backed WSL coordination root. No dependencies/build caches were created. Linux per-run SQLite files are removed only after both connections close; the failed Windows cleanup witness and its containing directory stay protected. Small final/failure receipts and vectors remain for Root's concrete integration review; no Windows free-space recovery is claimed.
