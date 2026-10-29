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
