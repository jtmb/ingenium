# Autonomous TUI Recovery

This is the canonical safety contract for recovering a terminal user interface
(TUI) parent or session whose task or tool transport ended before its outcome was
known.

## 🔴 Read-only recovery preflight

Before dispatching any restart task, recovery must perform and retain a
read-only preflight. It reads the exact project, workspace, storage mapping,
canonical worktree, parent/session/incarnation, epoch/fence/claim state, nonce,
and enrollment state; reads the newest durable handoff or typed operational
memory; and inspects the exact changed paths plus task, `TodoWrite`, status, and
`nextWork` state. The preflight must not signal, stop, restart, mutate, claim,
release, or clear state. An unknown outcome, dirty footprint, mismatched
binding, stale proof, or quarantined epoch remains unresolved.

## 🔴 Restart gate

An autonomous TUI parent restart is forbidden until one retained, content-free
proof bundle establishes every item below:

1. **Nonce/enrollment:** the replacement has a fresh run nonce and valid
   enrollment bound to the intended project, workspace, worktree, and session
   role.
2. **Durable handoff:** the accepted handoff records typed actions, changed
   paths, checks/results, task and `TodoWrite` state, status, and `nextWork`,
   without secrets, transcripts, or reasoning.
3. **External supervisor ownership:** a supervisor outside the parent being
   replaced owns the restart job, lease, and fence; the target parent cannot
   authorize its own replacement.
4. **Replacement health:** the replacement is running the current merged source,
   has the intended binding and loaded policy, and passes the actual health
   check before the old parent is retired.
5. **Reconnect/resume:** the replacement reconnects to the accepted session and
   resumes the first unfinished declared phase without replaying an uncertain
   mutation.
6. **Rollback/adoption:** a retained result proves either the bounded rollback
   path or an explicit, authorized adoption of the replacement, including the
   state to resume and the state to preserve.
7. **Split-brain fencing:** the old parent is quiesced and fenced, the successor
   fence/incarnation is newer, and stale calls from the old parent are rejected.

Legacy parents without valid enrollment or a nonce use automatic bootstrap:
the external supervisor enrolls and health-checks a replacement first and never
signals the legacy parent first. The legacy parent may be signaled only after
handoff, adoption/rollback, and fencing evidence permits it.

## 🔴 Abort and evidence rules

A task or tool transport abort is nonterminal. Treat the outcome as unknown,
preserve the first failure and worktree, and trigger immediate state recovery in
the same open turn. An aborted restart task is not a reason to end the turn;
continue with the declared recovery state machine or use an allowed escalation
condition.

`PASS` requires actual live TUI/session replay and `TodoWrite` replay evidence
from the replacement path, including reconnect/resume and split-brain fencing.
Source tests and deployed canaries remain separate evidence classes and cannot
prove actual TUI, session, or `TodoWrite` recovery.
