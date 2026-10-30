# Original runtime provisioning producer — source proposal

Owner: Projects and execution, branch `codex/veyra-parallel-projects`. Root is the sole shared Core/API writer and owns Node SQL127 registration, application, compilation and runtime acceptance. This proposal creates no database, principal, service or independent writer.

## Apply and regenerate

Against the exact five SHA256 preimages in `inputs.json`, run:

```sh
python3 docs/workstreams/projects/runtime-original-provision/prepare-proposal.py --core-source-root <coordinator-source>
git -C <coordinator-source> apply --check <absolute-proposal>/integration.patch
```

Root copies the single canonical new source from `sources/` to its corresponding original Core path and applies the five existing-file deltas. Root registers transaction-body-only `DDL127.sql` through the existing Core migration owner (its original transaction owns BEGIN/COMMIT); the worker has neither registered nor applied it to a live database. The generator refuses source drift. After Root begins integration, explicit `--recorded-git-preimage` regenerates the historical proposal from the recorded Git object only after each exact SHA check; it is not a current-source apply check. It does not snapshot shared sources or modify them.

## Ownership and behavior

Manager and API producer import the pure helper directly from `ingenium-core/lib/tools/runtime-original-provision`; the manager never runtime-imports the Core index. The API retains a separate type-only Core namespace import. The original private authenticated manager POST owns the creation witness. Only a new Docker create201 returned ID, start204, completed existing capability attach, immutable image ID and before/after same daemon can produce it. The initial closed probe permits health `starting` or `healthy`; this does not grant the fresh healthy Dot job role. Current inspection, labels, GET, reused containers and old managers cannot create an original. Missing prerequisites or metadata preserve ordinary legacy lifecycle with no qualification.

The API client generates a new request UUID, validates the immediate authenticated response against the exact public requested scope, original PROVISIONING revision, mapping, epoch and resources, strips wire metadata and keeps it only against the same returned object in a lexical WeakMap. Copied JSON is not a constructor. Capability, expiry and Env contents are excluded from the public request/spec fingerprints and durable metadata.

`transitionRuntime` inserts the original inside its existing transaction before the STARTING update. It requires the original current revision, active original lease, authorized workspace and actual current capability/credential/principal join. Missing SQL127 stays legacy without creating schema. The initial row is immutable; a replacement under the same runtime ID can continue its legacy lifecycle but cannot replace the initial receipt. No backfill or adoption exists.

`runtimes.getRuntimeOriginalProvision(runtimeId)` returns typed immutable metadata (including `recordedAt`), not qualification. Root must join it to the existing fresh Core126 image owner. Profile SHA is exactly the consumer hash of `{User,WorkingDir,Entrypoint,Cmd,HostConfig,Mounts,AppArmorProfile}` with the complete observed raw public profile. Start identity is exactly `hash([State.StartedAt,RestartCount])`. No profile normalization or fabricated health occurs. Root must compare the original container, daemon, image ID, start identity, scope, limits and mapping to the fresh healthy consumer result. The original requested spec SHA covers the selected nonsecret Docker create fields.

## Evidence and remaining gates

Seven focused cases execute the canonical TS producer directly with Node type stripping, the original manager spec builder, original Core126 public container consumer, and authoritative SQL001–126 plus proposed127 in memory. They cover exact birth/refusal facts, secret exclusion, request binding, transactional rollback, immutable initial storage, current authorization/lease refusal, replacement behavior and absent-schema rollout. The SQL fixture preserves every preexisting table digest and checks foreign keys. It explicitly models the original transition transaction; it does not execute the complete Core wrapper or a manager network request.

```sh
VEYRA_PROJECTS_PROVISION_SOURCE_ROOT=<coordinator-source> node --experimental-strip-types --experimental-sqlite --test services/ingenium-api/tests/veyra-projects-runtime-original-provision.test.mjs
```

No worker build, Docker request, native service, live migration, model or GPU invocation occurred. Root still owns actual TypeScript compilation, SQL127 registration, private manager transport/create/start/attach execution, fresh healthy consumer qualification and release acceptance. Full phase acceptance remains open.

## Storage and cleanup

All source/proposal/test/receipt paths stay under the existing authorized C-backed Ubuntu VHDX root recorded in `storage.json`; no alternate drive or output root is introduced. Tests use memory-only SQLite. TEMP/TMP/TMPDIR point to the existing task coordination root; the complete suite overwrites its existing TAP receipt. No dependency, build, cache, database or scratch output is created. Source, generator, frozen hashes, delta, DDL, tests and minimal receipts remain for Root application/review; their consumers end when Root integrates or rejects the proposal. There are no disposable generated-path exceptions and no disk-recovery claim.
