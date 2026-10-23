# Compatibility startup credential renewal — 2026-10-23

The full Ingenium release remains in progress. Continue development in the same
Codex chat; do not use OpenCode as a developer or create a successor chat.
The branch is `context-upload-hardening-opencode-1.18.9` and the existing remote
is `https://github.com/jtmb/ingenium.git`. Preserve unrelated working-tree changes,
production data, credentials, rollback images and retained failure evidence.
The complete checklist remains in `docs/operations/release-2026-10-23.md` and
the append-only roadmap.

## Problem and change

The restored installation's compatibility MCP credential expired on October 19.
Although its project, owner, authorized workspace, principal and epoch remained
valid, replaying the fixed bootstrap receipt returned 503 and prevented OpenCode
startup. The installation-authenticated bootstrap can now replace an expired
receipt credential with a new credential and token. The original immutable row
and its expiry remain intact. Subsequent requests replay the new token without
extending its lifetime.

Generic issuance still rejects expired receipts unless explicitly opted in.
Renewal checks the original request, scopes, grants, owner, project, workspace,
principal and security epoch. Expiry renewal does not bypass revocation: a revoked
receipt also requires the existing explicit revoked-receipt option. Runtime
capability renewal and its separate security boundaries are unchanged.

## Verification and review

- Core credential suite: 11 tests passed, including expiry opt-in, immutable old
  expiry, rejected scope changes, revocation handling and stable replacement replay.
- Compatibility bootstrap API suite: 23 tests passed, including successful expiry
  renewal and rejection after workspace revocation, principal revocation or epoch
  change without altering the receipt.
- API clean-core typecheck passed. The first run timed out during a host/WSL stall;
  its diagnostic is retained and the unchanged bounded check passed on rerun.
- Review confirmed that the installation-only route remains the authority,
  replacement issuance and receipt update share one database transaction, and
  old tokens never gain a later expiry. No credential value was emitted.
- Restored-stack runtime validation passed: the candidate image starts OpenCode
  and reaches healthy composite service health using preserved data copies.
  A separate local-runtime capability warning remains under assessment.
  No production adoption or full release acceptance is claimed.

## Remaining release work

The user cancelled multichat orchestration and coordinated parent recovery.
Those migration and simultaneous-session gates are no longer release work.
Finish dependency security fixes, retire the cancelled product entry points,
verify ordinary single-chat, memory and restart behavior, then validate the
settled image and exact production bindings with retained rollback. Complete
final browser review and reviewed publication. The startup credential repair
alone does not complete the full release.

The focused implementation owns the core credential source and regression suite,
the API compatibility bootstrap route and regression suite, and this checkpoint
note. Other startup, profile, build, recovery and source migration changes remain
separate review work. Consult the repository development/deployment skills and
existing focused test commands before continuing. Private restore paths, source
snapshots and logs are retained in the local release companion, not this note.
