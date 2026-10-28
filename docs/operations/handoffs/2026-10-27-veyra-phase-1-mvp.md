# Veyra Phase 1: Windows and Linux UI MVP

Planning is checkpointed. The next concrete phase is **Phase 1 — Windows + Linux UI MVP and external computer-use brain integration**. Complete the entire phase before creating Phase 2. Work directly in Codex; no subagents, no development through OpenCode and no edits to computer-use.

Read:
- [Phased delivery plan](../../plans/veyra-phased-delivery.md)
- [Visual acceptance contract](../../design/veyra-visual-contract.md) and [47 screen hashes](../../design/veyra-screen-contract.json)
- [Critical legacy reuse review](../../plans/veyra-legacy-reuse-review.md) and [74-row map](../../plans/veyra-legacy-feature-map.json)
- [Documentation deliverables](../veyra-documentation-plan.md)
- [One-receipt phase workflow](../veyra-phase-workflow.md)
- Current local feature-handoff skill and private companion supplied in the successor prompt.

The screenshots are the visual acceptance contract. Apply the explicit blue-mascot override consistently; OpenCode's upstream frontend/branding stays unchanged. Keep all Ingenium routes, feature controls and settings. Current images are generated concepts with illustrative content; do not import their sample JSON/model labels into live settings. Per-screen content/controls and shared-shell consistency need an explicit reconciliation, not silent drift.

The MVP is two tested builds: Windows on the user's machine, Linux Docker on the existing Ingenium Kubernetes cluster. Reuse qualified existing Windows Tauri/Rust/WSL code. Keep existing Windows inference behavior without further engine development; exclude that engine from Linux. Ordinary Chat and synthesis target requested ChatGPT GPT-6 Luna; preserve other model settings and all credentials. The separate brain must be loaded/verified in fresh OpenCode instances, not merely downloaded or listed in a source file.

No Phase 1 implementation, computer-use runtime registration, Rust cutover, Windows build or Linux rollout was done in this planning checkpoint. Earlier release defects and unaccepted gates remain open. The private companion contains exact checkout/commit/output/assets/legacy paths, held candidate image and draft chart state, stop/protection constraints and the unique receipt path. Do not reset a busy checkout or infer source files are disposable.

Before edits: verify the owned checkout branch/HEAD/relevant dirty state and intended remote branch SHA. Establish/confirm your own real full-scope active goal; do not mark it complete at MVP or handoff. Write the one matching small receipt and continue autonomously. After the MVP: update the plan/matrix/docs, finish checks/cleanup, checkpoint/push, create only the Phase 2 Sol/high chat, and archive yourself only after its matching receipt.
