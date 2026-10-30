# Memory worker evidence

Source base: `99eed8c6c0b47a043ec90d83e96f54f4f5cc2429`, branch `codex/veyra-parallel-memory`. Shared semantics: coordinator `docs/contracts/veyra-parallel-v1.md`. Only memory-owned prefixes changed. No root manifest/lock, migration, router, shared UI, upstream or runtime file changed.

## Checks

| Evidence | Result | Scope |
| --- | --- | --- |
| `tests-v1.tap` |33 passed,0 failed,0 skipped | Real SQLite policy/recall/CAS/forget/restore, file-backed reopen, Jobs and HTTP adapters, context budgets/scope/injection controls |
| `tests-source-revocation.tap` |1 passed,0 failed,0 skipped | Final inspection hardening: revoked sources are excluded from both retrieval and inspection |
| Dashboard `veyra-memory-controls.test.tsx` | Requested; not run by worker | Four behavior cases: exact identity/CAS changes, unavailable/unknown controls, reset confirmation, disclosure |
| API/dashboard TypeScript integration | Coordinator check required | Local `.d.mts` ports and production SQLite wrapper compatibility |
| Runtime, visual, Windows/Linux deployment | Open | No worker runtime start, inference, GPU, desktop, audio or production operation |

CPU command: see integration.md. Tests use injected fixture authorization/source/model adapters and the real SQL/schema; fixtures do not establish authenticated runtime or model quality. File persistence is measured through a closed/reopened test connection, not claimed as a deployed restart. The full amended run took26.288s; no performance comparison is inferred.

## Durable evidence hashes

Raw evidence stays in the already-assigned private worker coordination root, with no transcript/credential content.

| File | SHA256 |
| --- | --- |
| `tests-v1.tap` | `aaca3aff75431adc9bad24fc58eb165d66f2af7de8c54a8709cc2b6eb25ca1c0` |
| `tests-source-revocation.tap` | `2f8be71646fea264d69948f6af1ff25610720584e16439198f79b1263e636888` |
| `tests-first.tap` | `5f622820e249b8c015899d607fc156eb9d4410d27d23fffc85eeb985942acec5` |
| `cleanup.json` | `af3aeaca6f8764225cd3aba1b42d7ab0a4efb43b6060701c45079c4e3c9768b9` |

First failure is retained:15 checks passed and the file test failed to open `/persistence.sqlite` after shell expansion removed the intended parent. A direct WSL invocation with literal scoped environment paths and the explicit existing Node executable resolved it. The intermediate same-path failure signature is summarized here; its duplicate TAP was removed after final success. No rejected DB write created a file outside the owned root.

## Output reconciliation

Owner: memory worker, scoped active goal/ownership receipt verified. Physical storage: the existing C-backed Ubuntu VHDX, within the unchanged paired-root/20GiB task allocation. No cache, dependency tree, binary build, downloaded asset or model was created.

The following exact paths **relative to the assigned coordination/memory root** were removed after file-close, resolved ownership, source/evidence preservation and no-active-reference checks. `fuser`, `lsof`, exact mountpoint checks and active Docker inventory all cleared; no process/container was stopped.

| Removed path | Logical bytes |
| --- | ---: |
| `tmp/persistence.sqlite` |57344 |
| `tmp/persistence-final.sqlite` |65536 |
| `tmp/persistence-v1.sqlite` |65536 |
| `tests-second.tap` |6138 |
| `tests-third.tap` |5199 |
| `tests-final.tap` |7599 |
| `tmp/` (empty) |0 |
| **Total** | **207352** |

These are Linux logical file bytes; no Windows free-space recovery or VHDX compaction is claimed. No deletion safety check failed.

Retained: ownership/status/cleanup receipts, cleanup check recipe, original first-failure TAP, final33-check TAP and focused revocation TAP. Concrete consumer: coordinator source/security/integration review; retire duplicate evidence only after acceptance and preserve the minimal accepted receipt/hash record. Owned source/tests/docs remain the integration deliverable. No disposable compiler/cache/dependency/test DB remains. The cleanup recipe is not a recurring task or blanket deletion mechanism.

## Remaining acceptance

Coordinator: freeze concrete DTOs and route mount, allocate schema migration/parent constraints, wire real auth/binding/source adapters and existing Jobs quota/model/minimizer, mount controls with identity/epoch guards, preserve legacy explicit-memory/context/learning owners, qualify saved-memory regressions and the restore read barrier, run UI/typecheck, then controlled native/WSL/cluster fresh-chat/exclusion/forget/restore and attended visual gates. New inferred/external defaults and retention remain inactive until explicit integration decisions. Source readiness does not close the worker goal or full release goal.

## Policy controller continuation

Added the reusable `memory-v2/controller.mjs` with a typed port and dependency-free dashboard test. This replaces caller-only instructions for stale response handling and unknown policy writes with concrete code. It preserves exact operation IDs before sending, awaits the existing durable journal, survives controller recreation/reconnect, rejects stale scope/chat/binding callbacks, matches committed receipt identity/revision, and handles a settled earlier-chat write while another chat is active in the same scope. Absent receipts, proxy timeouts and unclassified HTTP failures never trigger a write replay. Only recognized status/code API rejections release the journal without a committed receipt. A journal persistence failure prevents transport entirely.

The policy response now includes authoritative scope hash/chat/binding hash/epoch metadata; no route, migration or shared DTO file was edited. The coordinator's API adapter still supplies real capability evidence and the existing draft owner still supplies the durable request journal. Fixture recreation proves controller behavior against that port, not production browser storage or runtime integration.

`tests-controller-durable.tap`: **11 passed,0 failed,0 skipped** (nine controller cases plus two real-SQLite API facade cases). SHA256: `91c21ad461afa63d7484b4b801d920f812c48b5901aab87335af79aab200fb74`. This focused run follows the earlier33-check baseline and the1-check source revocation regression; the counts are separate and include repeated API coverage.

`cleanup-controller.json` records another **5033 Linux logical bytes removed**: coordination-relative `tests-controller.tap` (2395), `tests-controller-final.tap` (2638), and empty `tmp/` (0). Exact containment, no-active-handle/mount/container checks passed, with no retained exception. The original cleanup receipt remains unchanged; combined removal is212385 logical bytes, with no Windows free-space claim. Retained new evidence: final controller TAP and cleanup receipt, for coordinator source/integration review. No fixture DB, dependency, cache or build output was created in this continuation.

## Completed-input extraction watermark

A completion audit found the watermark previously rejected duplicate persistence only after a new-operation duplicate delivery had already run extraction. `processedExtraction` and the Jobs preflight now check completed input before quota, model or minimizer calls. The normal scope/capability/source admission still runs first. A prior completed input returns `already-processed` and its original memory ID; it does not invent a new committed operation receipt. In-flight exclusivity still requires the existing Jobs lease, with the transactional watermark guarding commit races.

`tests-watermark.tap`: **6 passed,0 failed,0 skipped** (four prior Jobs behaviors plus two new completed-input/scope checks). SHA256: `967df2318e1e1c0aebcde72fd7f0328c25dcf289835b7c8ae96d7a43aa087f70`. All are dependency-free CPU checks against SQLite fixtures; no provider/runtime was started. The empty scoped `tmp/` directory was removed after active-reference/container/mount checks; `cleanup-watermark.json` records0 logical bytes and no retained exception. No new build/dependency/cache/DB artifact was created. Raw final TAP and cleanup receipt remain for coordinator review.

## Existing API persistence/auth/source adapters

Coordinator requested actual core-compatible adapters after integrating through `6d52d341` and passing the memory UI4/4 plus reported API/dashboard noEmit checks. `production-adapters.md` records the inspected source authorities, required real resolver ports and remaining native-wrapper/type/runtime gates.

`tests-adapters-final.tap`: **19 passed,0 failed,0 skipped** (eleven production-interface adapter cases plus eight API/Jobs regressions). SHA256: `16a2f2004843b93b0c263996bab8372ad9b33f63334860e6e12730b429eefc02`. These are SQLite fixtures using exact existing column/transaction signatures, not a native wrapper or authenticated live-runtime qualification. No model/provider/runtime was started.

The adapter delegates transaction ownership to existing `execTransaction(work,1)`, checkpoints only after commit, rejects nested/replaced connections, resolves actual owner/membership/workspace/runtime/chat identity, validates canonical Context source hashes and gates explicit-memory injection across policy changes. Missing authoritative native/projectless/source evidence remains denied or unavailable; there is no unconditional allow or global-project fallback.

`cleanup-adapters.json`: removed coordination-relative `tests-adapters-first.tap` (4438 bytes), superseded by the19-check final receipt, and empty `tmp/` (0). Exact containment/handle/mount/container checks passed with no retained exception. Combined task removal is216823 Linux logical bytes; no Windows disk-recovery claim. Retained new evidence is the final adapter TAP/cleanup receipt for coordinator review. No dependency/compiler/cache or fixture DB file remains.

Final connection-pinning amendment: connection identity is checked for every resolved scope, including a genuinely supplied native/projectless scope. `tests-adapters-connection.tap`: **11/11 passed** after that amendment, SHA256 `5fe17fc0ed43d60a5c762eb129ae38429ead9486e56a2be33a49832e4850007f`. The existing19-check receipt remains the preceding adapter/API/Jobs batch. `cleanup-adapters-connection.json` records removal of the new empty scratch directory,0 bytes/no exception. `core-session.ts` now binds the actual exported core functions statically; its noEmit/native-wrapper smoke check is requested from the coordinator and is not claimed by the fixture tests.

## Central real-core test submission and reporting

Human reporting authorization was verified directly in coordinator messages `01a18978-80e0-7752-993b-52feaa569b6c` and `01a18979-44b3-7f40-baa8-ed97c46ab40c`; the worker sent its actual branch/HEAD/test/blocker report and the coordinator acknowledged it. A newly found facade defect was reported immediately: actual core `MEMORY_SCOPE_NOT_FOUND` was not a MemoryError and would surface as generic500. The coordinator approved the narrow normalization to403; unexpected core/DB failures remain500.

`tests-scope-denial.tap`: **1 passed,0 failed,0 skipped**, SHA256 `97a7317115c74360affa36bdadfaab88b76d4994cdf3230e0bb1d4ac8f06dd53`. This dependency-free regression covers both expected scope denial and unexpected error preservation. It does not qualify the new real-core Vitest suite.

`veyra-memory-core-adapters.test.ts` supplies six actual-core/alias cases for the central runner: actor/session denial, credential attestation/revocation, workspace epoch revocation, same-scope fresh-chat persistence and durable forget with original-row digests, post-commit original receipt preservation, and explicit saved-memory read gating. No proposal schema, mocked DB/auth/workspace functions, live engine or inference is used. The suite requires migration123 and an explicit owned fixture root and has **not been run by this worker**. Exact command,32MiB conservative fixture budget and retention/cleanup contract are in production-adapters.md.

Only owned source and the focused1-check log/cleanup receipt were generated locally. `cleanup-real-core-source.json` reconciles the empty temporary directory (0 logical bytes), with no failed safety check. No actual-core fixture, build, install, model, runtime or desktop workload was started. The coordinator owns production resolver/route/journal/restore wiring and the new central test run; unresolved bindings are reported explicitly rather than treated as success.

## Central r3 failures and narrow repair source

Inspected `coordination/integration/api-types-r3.log`: actual core `getDb` was not assignable to the local SQL port because better-sqlite3's inferred positional/object statement union rejects null under its object branch. The fix is a concrete typed positional-method adapter, not a cast. Same handle identity, transaction/checkpoint owners and binding values are preserved.

Inspected `coordination/integration/memory-core-r3.log`: **1/6 passed,5 failed during fixture setup**, all with the real unique organization/service-principal name constraint. Per-case explicit principal/credential identities repair that setup without weakening the schema or mocking auth. A same-handle/null/rollback test raises the revised suite to7 cases. Both failures, the minimum repair and the manifest overwrite risk were reported directly to the coordinator. Its retained first-failure DB/manifest and raw r3 logs were not altered or deleted.

This repair is source-only pending the coordinator's new noEmit and7-case Vitest run. No new runtime/build/core fixture or disposable scratch was created locally; no additional disk recovery is claimed. The prior passing worker checks do not establish that this new central repair passes.

## Request-session composition source

The new request-session/source/request-policy modules implement frozen shared identity/Projects composition, strict current authorization/CSRF, engine IDs with trusted history-only source purpose, canonical completed-source and runtime facts, approved6h1–48h policy and original-journal admission/version revalidation. Policy/journal absence leaves generation unavailable while preserving qualified/explicit recall and policy controls. Generation/backup/restore are denied on this public request port; root job/maintenance ownership is unchanged.

Final dependency-free **34/34 passed**, SHA256 `fd182e5e6bc04960251f1e95ff7afeea8723820cab55352336cbc5ab546639cb`; command/provenance/first failures and remaining central composition gates are in request-session.md. This is not a shared-module noEmit or real HTTP/model qualification claim. The original goal remains unfinished.

Request-stage cleanup removed21094 logical bytes of superseded passing TAPs and empty scratch, no failed checks. Unique journal-race and SQL-template failure witnesses plus final evidence remain. Combined worker removal237917 Linux logical bytes; no Windows disk recovery or protected central-fixture deletion is claimed. No build/install/services/models/desktop or new DB/journal/scheduler was started. Concrete policy/journal/error/history interface dependencies were reported directly; coordinator supplied their frozen semantics.

Scope-only Settings follow-up: additive authorized read-only scopePolicy and GET scope-policy facade,24pass/0fail/1existing persistence skip; exact command/hash and remaining central HTTP/type gates in request-session.md. No file DB/build/runtime outputs created.
Codex primary-source correction2026-10-30: global future-ingress/journal prerequisite withdrawn. Implemented bounded completed engine-owner snapshots and selected-prefix Context verification; later outside material excluded, selected source/policy/deletion/suppression rechecked. Final43/43CPU checks pass; exact pinned evidence, implementation/port boundary and test hash in codex-completed-snapshots.md. Production canonical owner composition and full acceptance remain open.

Canonical OpenCode follow-up: actual existing client/target-context TypeScript binding plus async capture/selected refresh, exact private Context/checkpoint mapping and optional awaited Jobs verification hooks.55/55focused CPU cases passed; opencode-canonical-reader.md records exact command/hash, API owner/external provenance/recent-page limitations, integration recipe and remaining central type/runtime gates.
