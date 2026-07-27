---
name: security-audit
description: "Bounded security review of current diffs and relevant dependencies. History scanning is a one-time response to a confirmed secret or critical explicit trigger."
---

# Security Audit

Use this skill for security-sensitive current-diff review, dependency review, a confirmed secret, or an explicitly requested critical history investigation.

## 🔴 HARD RULEs

1. Never commit secrets to source. A confirmed secret must be reported with safe remediation guidance.
2. The default review is the **current diff and relevant dependency changes**. Do not use a repository history scan as a routine escalation.
3. A history scan may run **once** only for a confirmed secret exposure or a critical explicit trigger in the user request/task contract. Record the trigger and count.
4. Classify findings as **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. Security findings outside `IN_SCOPE` are FOLLOW_UP unless changed code is immediately exploitable.
5. Only immediately exploitable changed code may be an in-scope BLOCKING finding. A second failed execution of that blocking check is **ESCALATE_USER**; do not retry or widen the scan.
6. STOP and CANCELLED are terminal: preserve evidence and do not start security, QA, Docs, visual, or follow-up work.

## Bounded Process

1. Require `IN_SCOPE`, `OUT_OF_SCOPE`, acceptance criteria, `STOP_CONDITION`, verification budget, and escalation rule.
2. Review only applicable changed code and dependencies for secrets, injection, authorization/data exposure, unsafe execution, and supply-chain risk.
3. If the one-time history condition is met, use a targeted pattern and report its evidence. Do not create Docs pages or dispatch remediation.
4. Report evidence, scope status, classification, history-scan count, and skipped work.

## Finding Classification

| Classification | Meaning | Action |
|---|---|---|
| **BLOCKING** | In-scope, immediately exploitable changed code | Parent may use its one writer remediation round |
| **FOLLOW_UP** | Out-of-scope or non-immediate security risk | Report separately; never auto-dispatch |
| **INFORMATIONAL** | Context or hardening suggestion | Report only |

## Reference Files

| File | Content |
|------|---------|
| [`references/trusted-first-party-iframe-rule.md`](references/trusted-first-party-iframe-rule.md) | Origin-based iframe sandbox decisions and Permissions Policy |
