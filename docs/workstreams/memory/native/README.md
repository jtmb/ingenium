# Native learned-memory source proposal

Status: **unapplied and uncompiled**. This is a source proposal for the existing
Native owners, not Native runtime acceptance or completion of learned memory.
Native reference: 4e8e29436cfe42c81cc6401599cf8d224357a928.
Required Projects proposal: 7250f55f92e6554c47b945a529fbbbe7de114c06.

proposal.json contains 24 narrow edits with pinned-blob SHA-256 preconditions
and unique exact preimages. sources.json maps modular files to proposed Native
destinations with hashes. The generic controller is reused as source with one
declared import transformation. Preparation never changes a Native checkout.

## Original owners and preservation

- Original GoalStore, Goals.store mutex, uncertainty refusal, ACL helper and
  atomic replacement own additive learned-memory-v1.json. Legacy goals.json v1,
  goal IDs, explicit local/project/session saved memories, enabled state and
  existing goal selections retain their semantics.
- Original prompt preview, MemoryAdmission and final guarded admission receive
  concrete proposed changes. Old originals have no learned field and are never
  backfilled. Submit validates retained learned entries and source revisions
  instead of selecting fresh learned context.
- Original promptOriginal.ts owns bounded pending-policy witnesses under a
  distinct key. Exact successful receipts are retained before removal. Missing
  receipts and lost responses retain the operation without automatic replay.
- Existing explicit-memory UI is preserved. Separate React controls compose
  beside it in Workbench. They use authoritative Native inspection, never
  fabricated Cloud organization/user identities.
- Scope derives actual library, sealed OS custody, execution environment and
  original Project/private namespace. The private Arc calls verify_current
  against actual ProjectStore and service instance. Regular Projects revalidate
  their original complete record under the real mutex. Filesystem custody is
  not a registry permission.

## Bounded source behavior

Root reconciliation required: Projects now owns the ONE scoped bounded-recent
OpenCode client extension. The memory-specific client insertion from eddbd5f2
is superseded and removed from this proposal. The existing LiveRuntime wrapper
is its consumer. Root must bind its annotated provisional call to the actual
frozen Projects export and verify scope, latest-desc first-page ordering,
overfill refusal and chronological conversion before Native apply/build.
No guessed replacement API or second client method is introduced. The exact-ID
refresh implementation remains in the memory adapter.

Canonical OpenCode requests one latest page of at most 32 messages, never
follows a cursor and never uses unbounded context/history. Capture requires
complete adjacent user/terminal-assistant pairs, original prompt provenance and
a 6-hour default idle interval (policy permits 1–48). It refuses partial,
multi-assistant, unowned, errored and unrecognized terminal turns. It never
invents completion or external=false. Original files, skills, memories, hooks
and canonical tool-bearing turns conservatively count as external context.
Missing provenance is unavailable.

The pure Rust domain bounds text, preserves exact bytes, retains source
hashes/revisions and model/input provenance, requires separate generation/use/
external/chat-contribution choices, and keeps idempotent CAS receipts.
Refresh re-reads selected IDs; unrelated later messages are allowed.
Forget suppresses stable scoped source identity, content and entry identity.
Restore merge retains current suppression, processed inputs, receipts and policy
choices over stale backups. The original Goals mutex remains held through final
checks and durable prompt capture; no new whole-chat fence exists.

## Verification and open gates

Executed: four Node tests of the actual JS adapter (policy/idle preservation,
lost-policy response, lost-forget response, failed custody before send), one
source-manifest test (5/5 pass). Original eddbd5f2 verified 25 preimages;
the reconciled proposal has 24 because the duplicate client insertion is removed.
Five Rust tests authored, **not executed**.
No Cargo/rustc/npm/install/build, model, service, desktop control or inference.

Remaining integration gates, not claimed:

1. Review/apply combined Projects and memory proposals in the owned Native
   integration checkout. The authorized Native owner updates the lockfile,
   binds the actual frozen shared bounded-recent export, compiles Rust,
   typechecks and renders React.
2. Connect concrete Goals.capture_learning/accept_learning methods to the
   existing generation/model owner. No model dispatcher or scheduler is added.
3. Mount projectless prompt originals only when their original owner supports
   them: pinned PromptOriginal requires a real Project. Private controls never
   fabricate a Project.
4. Verify existing backup/delete orchestration includes the additive file.
   Privacy export includes learned state. The suppression-preserving pure merge
   is not a mounted restore endpoint. Cross-custodian import requires original
   backup-owner custody and scope verification. Root reports Core's actual
   capsule now carries a content-free forget/reset ledger and transactional
   merge at e44a13dd; the actual restorer and Native owner composition remain
   open. This worker does not duplicate that authority or claim restoration.
5. Qualify legacy memory-off/Windows/explicit-user-WSL compatibility, auth/IPC,
   persistence, actual completed-source semantics, uncertain writes, source
   edits/deletion, private isolation, UI workflow and prompt admission.

Regeneration: prepare-proposal.ps1 prepares review JSON from the read-only Git
object database. The host blocks direct unsigned UNC script loading. The worker
evaluated its reviewed source in the existing process without changing execution
policy. Source manifest hashes can be recomputed from listed paths without
generated dependencies. Adapter check:

    node --test tests/veyra-memory-native-adapter.test.mjs

All output remains in the existing C-backed Ubuntu VHDX task root. Source,
minimal proposal JSON and one TAP receipt are retained for Root's review.
No dependencies, compiler output, caches or scratch were created. Stage cleanup
removed **0 bytes**. No Windows disk recovery is claimed.
