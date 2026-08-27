# COORD-106 r24 multi-session acceptance proof

This directory retains a sanitized, repository-tracked proof of the original
COORD-106 r24 acceptance run. It is a derived evidence bundle, not a transcript.
The original 29 JSON artifacts remain optional local provenance; their names and
SHA-256 digests are retained in `artifact-ledger.json`.

## Evidence classes

| Class | What it proves |
|---|---|
| Actual model/session | Three simultaneous OpenCode processes, peer-memory injection, memory-derived Reads, writes, conflict behavior, and restart replay. |
| Deployed canary | Atomic quarantine/recovery, generation fencing, outage behavior, cleanup, and deployed health. |
| Source | The accepted coordination source captured by commit `2d825b9f48fb7f51df37dd7e9f91dcd9072c855b`, and the later reset source in `f6c5c07df995cb5d4694431f318862f93a9e4ca5`. |
| Review | The bounded QA and security conclusions retained by the original run. |

`proof.json` is the gate matrix and provenance index. `event-excerpts.json`
contains only structured, sanitized excerpts. Raw session, actor, incarnation,
fence, claim, credential, process, port, and mutation-path identifiers are absent;
worktree and mutation targets are represented only by SHA-256 values.

## Revision boundary and limitations

The original rollout record reports repository revision
`5ea014a6624e88242ae40e03ce886b9ebaa020e3`. The accepted coordination source
was captured afterward by its direct child commit
`2d825b9f48fb7f51df37dd7e9f91dcd9072c855b` (tree
`138c99f609b22c9608540152df4338f6fbd8a820`). The bundle preserves both facts
and does not rewrite the run metadata to claim that r24 reported the later
commit.

The protected reset change in
`f6c5c07df995cb5d4694431f318862f93a9e4ca5` has separate source and deployed
evidence recorded by `86e268e6943c453cc30a58a55b39a47f804cd0ac`.
It was not exercised by r24, so no r24 model/session or r24 canary gate is used
as evidence for that behavior.

This bundle intentionally excludes raw credentials, prompts, source bodies,
diffs, shell commands or output, arbitrary model prose, and reasoning. Sanitized
excerpts establish ordering, tool kinds, result codes, counts, versions, evidence
class, and boolean outcomes without reproducing private payloads.

## Validation

Standalone validation requires only the committed bundle:

```bash
node docs/evidence/multi-session/coord106-r24/validate.mjs
```

When the ignored original run is available locally, deep validation also checks
all 29 original digests and the original privacy artifact:

```bash
node docs/evidence/multi-session/coord106-r24/validate.mjs --original tests/artifacts/test-runs/run-20260827T0022Z-coord106-r24
```

`bundle-checksums.json` covers every bundle payload and the validator itself; it
omits only its own recursively unverifiable digest.
