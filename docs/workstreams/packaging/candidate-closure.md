# Original candidate artifact closure follow-on

Source-only packaging proposal, 2026-10-30. Product-facing bot name: **veyra-bot**. Root owns canonical integration, actual compiler/build/runtime work and the unfinished original SQL131 waiting-child/readiness/material owner. No worker source proposal is production approval.

The original candidate proposal `1b3d255131e493d40ca060129fde16e4f5124797` and VS Code removal proposal `930964a103a8602c1666b5b5ec52d1ce66dcc366` remain frozen. This follow-on reads the actual Root-applied packaging16/Dot19 source, Root's repaired executable MJS bytes, the shared ResponseVerifier declaration import, and the current VS Code-free Dockerfile. It does not restore an old preimage, old editor runtime or old grant. Exact current preimage hashes and postimages are in `candidate-closure-receipt.json`.

## Explicit source and image additions

`candidate-closure.patch` proposes four canonical edits:

1. `packages/veyra-operations/core126-image-contract.mjs`: preserve the existing ordered 36 source/31 image rows; append 67 explicit source and 48 explicit artifact paths, resulting in **103 source / 79 image** rows. Existing scopes, case set, timing, approval validation, file ownership/modes and fail-closed behavior remain unchanged. The expanded closed metadata fits the existing 64KiB candidate-source-file cap in a maximum-size-metadata budget test; no limit was relaxed.
2. `services/ingenium-api/scripts/copy-domain-runtime.mjs`: retain the same copier, its existing reviewed roots and its two existing release-tool singletons. Add an explicit required-MJS check and five reviewed TypeScript import-relocation inputs; no new glob, discovered root, source tree copy, duplicated helper or compiler invocation.
3. `Dockerfile`: after the original compiled package/distribution/migration COPY operations, require the 48 additional exact image paths to be real root-owned regular files, non-writable by group/other and nonempty. This is a source proposal for build-time filesystem checks; the worker did not execute it. No module imports, model/tool execution, package installation or runtime proof is hidden in that check.
4. `scripts/validate-deployment-config.sh`: reconcile its exact existing protected-plugin directory requirement with the already-applied job-agent plugin directory in Docker. Root had already removed the obsolete editor socket requirement; the proposal leaves it removed and includes no duplicate restoration/deletion.

The eight new candidate executables and their exact artifact mapping:

| Source | Artifact |
| --- | --- |
| `packages/veyra-operations/core126-candidate-material.mjs` | `/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-candidate-material.mjs` |
| `services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.mjs` | `/app/services/ingenium-api/dist/lib/dot-v2/candidate-bootstrap-runtime.mjs` |
| `services/ingenium-api/lib/dot-v2/candidate-carrier.mjs` | `/app/services/ingenium-api/dist/lib/dot-v2/candidate-carrier.mjs` |
| `services/ingenium-api/lib/dot-v2/candidate-docker-stream.mjs` | `/app/services/ingenium-api/dist/lib/dot-v2/candidate-docker-stream.mjs` |
| `services/ingenium-api/lib/dot-v2/candidate-loopback.mjs` | `/app/services/ingenium-api/dist/lib/dot-v2/candidate-loopback.mjs` |
| `services/ingenium-api/lib/dot-v2/candidate-original-invocation.mjs` | `/app/services/ingenium-api/dist/lib/dot-v2/candidate-original-invocation.mjs` |
| `services/ingenium-api/lib/dot-v2/candidate-private-plugin.mjs` | `/app/services/ingenium-api/dist/lib/dot-v2/candidate-private-plugin.mjs` |
| `services/ingenium-api/scripts/runtime-candidate-bootstrap.ts` | `/app/services/ingenium-api/dist/scripts/runtime-candidate-bootstrap.js` |

All seven MJS inputs already reach the actual existing 82-module copier plan exactly once. The TypeScript bootstrap is inside the existing API `scripts/**/*.ts` compiler include and output/rootDir policy; no new compiler include is necessary. This is read-only planning evidence, not emitted artifact evidence. Root's removal of invalid `export declare const` text in the two executable MJS sources is covered by JavaScript VM parsing of all seven actual MJS candidate inputs. The existing candidate-bootstrap-runtime declaration imports the same `ResponseVerifier` from `managed-job-contracts.mjs`; this follow-on fingerprints it rather than manufacturing another verifier type.

`candidate-closure-inventory.mjs` enumerates every addition. Besides the eight candidates, the 40 executable authority inputs/artifacts include:

- The image contract and original manager proof producer themselves, actual Core factory, original context, installed approval reader, approval-policy reader, job policy, request binding, repository/service/schedule/existing-job logic and original request-chat-source helper.
- Original JobResponseVerification, manager client/token/placement adapters, managed-job owner/Core client, actual broker/provider/runtime adapters and existing provider selection client.
- Core index/database/schema and original delegation, JobRun/runtime/context/trusted-event/agent/authorization/MCP-policy/provider/vault/provision/authentication modules. The actual private candidate-context brand and Core delegation implementation now receive explicit source and emitted-artifact fingerprints, rather than only the generic Core entrypoint or a declaration interface.

Nineteen non-executable/build inputs add the seven candidate declarations, existing candidate observation/image-owner/managed-job declarations, deployment validator, API/Core/base TypeScript configuration, API/Core package manifests, and actual SQL126/129/130 files. No SQL131 source existed at this audit. Root must explicitly add its real migration and any additional actual owner/coordinator modules when implemented, rather than using a wildcard, invented filename, fabricated postimage or claim that this follow-on covers future source.

## Correct compiled import paths using the same copier

Concrete issue: source `services/ingenium-api/scripts/runtime-manager.ts` imports `../../../packages/veyra-operations/core126-candidate-observation.mjs`. That is correct relative to source. Unchanged at `dist/scripts/runtime-manager.js`, it resolves under `/app/services/packages/…`, while the reviewed copier puts the dependency under `/app/services/ingenium-api/dist/veyra-packages/…`. Type checking against source can pass while this packaged import fails.

The same depth change affects runtime imports in `dot-original-context.ts` and `core126-installed-image-owner.ts`. `core126-actual-factory.ts` and `core126-runtime.ts` have type-only cross-root image-owner references that also need correct declaration paths. These are the exact five reviewed relocation sources; the receipt records every source specifier and target.

The proposed original copier:

- Resolves those explicit source MJS imports through the same already-reviewed MJS source-to-target map. A required candidate module or cross-root runtime dependency missing from that map refuses the plan. No alternate node_modules tree or symlink supplies a fallback.
- Parses original compiler JS and declaration outputs and changes only matching import/export/import-type specifiers to the same singleton/copied targets. Runtime imports must occur exactly once; duplicate/missing required imports refuse. Type-only imports need no runtime export and are handled separately from actual JS.
- Checks exact existing compiler output paths stay under the same destination, are canonical regular single-link files and bounded in size. Plans every compiler postimage before writing any outputs. Existing MJS and these ten JS/declaration rows share one `veyra-runtime-closure.json` source/emitted-hash manifest.
- Uses TypeScript's AST parser only for import rewriting. It neither calls tsc/transpile/emitter nor executes a generated module. Root's actual build invokes its original compiler first, then the same copier as before. Package compiler outputs, declaration emission and installed payload still require actual validation.

An existing **voice-v2/request-context.ts** cross-root runtime import of `packages/veyra-voice/session.mjs` exhibits the same output-depth pattern. It is outside the five candidate-specific inputs in this patch and is explicitly reported to Root/voice for owned integration; this follow-on does not silently change the other workstream. Do not claim every TypeScript cross-root import in the application has been repaired.

## Import audit boundary

The receipt contains hashes for all 103 current actual Root source inputs and a parser-only static import audit of 49 selected candidate/authority/plugin modules, including the absolute job-agent plugin import of the new candidate-private-plugin artifact. These are **pre-integration source receipts**, not candidate-source.json material, measured file observations, approval evidence or runtime output. After applying the patch, Root must generate the real source/image inputs from its final integrated source and actual artifacts; proposal preimage hashes must never be substituted for them.

Every direct executable relative import of the new candidate modules, actual Core factory, original context and Core delegation is checked against the explicit selected source closure. The audit retains residual edges to existing helpers/types and Core's broad public barrel, without pretending that a selected qualification list is the entire application dependency graph. Node builtins, original package dependencies and unrelated existing transitive modules continue to require the full-source SHA, package lock and immutable original image ID/config/diffID boundary. None may be replaced by a caller DTO.

Concrete existing non-barrel runtime residuals are `chat-provider-catalog`, `chat-model-variants`, API config/index, `runtime-opencode-context`, `runtime-provisioner`, `synthesis-provider-resolution`, Core logger/restore-fixture-path/job-event-deliveries/coordination/paths/vault-crypto/protected-settings/identity. Their edges are preserved in the receipt for Root review rather than hidden by a claim of complete transitive closure. Historical Core public exports and type-only `veyra-automation/contracts.d.ts` references are not new candidate executables. Expanding the entire application graph or other workstreams is outside this bounded proposal.

This source change does not install or call `withOriginalCandidateCoordinatorOperation`, allocate a candidate claim, acknowledge admission, create/start a waiting child, attach to Docker, issue credentials/frame/material, make a loopback server ready, observe egress/traps, retire a process or install independent approval. The real SQL130/131/coordinator assembly and restart-safe unknown-process ownership remain Root gates. No absence of a caller or missing readiness authority is papered over with a fake approval, context, boolean or fallback.

## Validator follow-on and meaningful regression

Independent review correctly found a gap in the 12-check VS Code source suite: it did not execute or fully interpret the existing deployment validator, so it missed an obsolete positive requirement for the removed stale editor socket helper. Root removed that line. Restoring the helper to satisfy it would violate the new editor-absence requirement and touch protected historical state; this follow-on never does so.

`deployment-literal-guard-audit.mjs` tokenizes simple source-level `require_literal`/`reject_literal` commands without shell evaluation, command substitution, invoking the validator or opening runtime data. It resolves known source-path variables, preserves single-quoted dollars and escaped apostrophes, and checks their actual/proposed target bytes. **317 resolvable guards agree; 14 dynamic guards remain unexamined.** This stronger check found another real drift: the old positive protected-plugin directory chain omitted `plugins/enforce-job-agent`, which Docker already has. The four-path patch fixes that exact requirement.

Regression tests append the actual obsolete socket requirement to the otherwise repaired validator and require the checker to report exactly that missing source literal. The suite also checks rejection of shell substitution, required MJS omission, missing/duplicate compiled import occurrences, proper type-only/declaration handling, actual in-memory copier target mapping and all original input bytes remaining untouched. This checks the integration contracts that the earlier source-only suite missed; it is still not a claim that the full shell validator or live migration ran.

## Verification, remaining gates and cleanup

Fifteen tests pass under Windows Node 24.18.0 and WSL Node 22.23.1. The proposed original copier was evaluated in a controlled VM with the actual filesystem/parser dependencies, then used only to plan into an explicitly non-materialized path inside the existing coordination root. No output directory was created. The exact patch passes `git apply --check` against actual Root source, without applying it. Shell parsing covers the validator and new Docker RUN recipe without executing either. No semantic compiler, distribution build, nginx render, Docker operation, candidate/application runtime execution, network request or model ran.

Root still must apply/review current postimages; run complete static validators (including the 14 dynamic guard cases and order/regex/path checks), actual compiler/copier/module-resolution and Docker filesystem checks within existing approved storage limits; inspect final package artifacts; implement and fingerprint real SQL131/coordinator additions; verify waiting-child/trap/catalog/private-egress/readiness/credential ordering, all 18 actual original runtime cases, restart/unknown retirement and independent protected approval. Prior release acceptance, VS Code-removal live payload/denial/preservation and Work/Web/CLI/terminal/Git/restore gates remain open. Source tests or strict API/Core type checks are narrower evidence.

Reuse the original task-owned C-backed WSL root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`; no new checkout, drive, root, source snapshot, dependency tree, build, compiler cache, download or temporary output was created. Nine small durable artifacts under this worker's existing `docs/workstreams/packaging/` plus the one existing coordination status are the complete generated inventory. Source proposal/inventory/copier fragment/literal auditor/test/freezer/patch/receipt/guide remain for Root's integration/review and actual acceptance. Regeneration is recorded in the receipt using process-scoped TEMP/TMP/TMPDIR at existing `coordination/packaging` and an empty NODE_COMPILE_CACHE.

Cleanup reconciled: **removed paths: none; measured removed bytes: 0; new disposable outputs: none**. All protected Native targets, Cargo homes/caches, original failures, user/runtime/editor/workspace data, backups and frozen proposal evidence were untouched. No Windows free-space or Linux filesystem recovery is claimed.
