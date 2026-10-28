# Veyra phase handoff workflow

Derived from the working Kubernetes feature-handoff pattern at the user's request. The local Codex skill remains in the saved project's .agents/skills/feature-handoff directory; operator-local skills/private receipts are not app runtime files.

One phase per local chat, gpt-6.1-sol / high; no subagents, no OpenCode development and no computer-use repository edits. Read the full delivery plan and screenshot contract. Do not rotate because of context, time, an active job or a minor feature checkpoint. The current planning handoff is explicitly requested before Phase 1.

Finish phase scope, focused checks, actual Windows/Linux gates and documentation. Preserve all incomplete full-goal requirements and failures. Reconcile owned outputs/processes. Review only intended diffs; commit/push to existing intended remotes and verify exact remote branch SHA. Never sweep dirty unrelated work, reset a shared checkout or turn package/source tests into runtime evidence.

Give the next chat the portable handoff and one private companion: owned checkout/branch/SHA, exact source/assets/output root, full objective, one next phase, acceptance, active processes, protected paths and a unique small receipt location. Use list_projects + create_thread, same project, local, model gpt-6.1-sol and thinking high. No extra worker chats.

Before editing, successor verifies its OWNED checkout/branch/HEAD/relevant dirty state and remote SHA. It reads get_goal; establishes its own full-scope active goal if absent, without overwriting an unfinished goal or inventing a budget. Write one receipt: accepted, threadId, branch, commit, nextPhase, handoffsRead, goalStatus, goalScope, ownershipAccepted. Values reflect actual tool results. The receipt accepts exclusive ownership and the successor continues; no separate startup-ack/owner-release exchange.

Parent verifies the matching receipt and stops its old writers, then archives ONLY itself. Leave current chat open if checkpoint/creation/receipt fails and record the actual error. Never archive the successor or silently waive gates. The full goal stays open until the release is genuinely complete. Each next phase repeats this workflow.

Re-read the latest user decisions at every handoff. Architecture/scope choices not yet approved remain decisions, not permission inferred from a screenshot or checklist.
