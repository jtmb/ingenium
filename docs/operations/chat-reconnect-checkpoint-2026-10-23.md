# Reconnect a renamed chat without losing its saved context

The full Ingenium release remains active. Continue in the same Codex chat;
OpenCode is only a product under test. Multichat orchestration and coordinated
parent recovery remain cancelled. Preserve production data, rollback images,
unrelated working-tree changes and retained failure evidence.

## Problem and repair

After a completed turn, OpenCode can change the session title. Reloading then
linked the same session with its new title, which conflicted with the original
immutable conversation creation receipt and returned `IDEMPOTENCY_KEY_REUSED`.

The link route now resolves an existing conversation by its exact project,
organization, owner, private visibility, runtime and session identity. It returns
the saved conversation with its original immutable title, revision and
checkpoints. It does not create another conversation or change the generic
conversation idempotency contract. Runtime authorization still runs before this
lookup, and all SQL values are parameterized.

## Evidence and remaining work

The API conversation suite passed four tests, including linking a renamed session
after a saved turn and retaining its conversation ID, original title, revision
and checkpoint count. Existing private-content denial coverage remains intact.
API clean-core TypeScript validation passed. Browser run
`a7f9819d-cf52-49ea-80f1-82cb5b501716` passed all three selected checks:
send/receive, persisted-session desktop/mobile Markdown rendering, and real
password login followed by hard reload without duplicate messages/checkpoints.
Desktop 1440x900 and mobile 390x844 screenshots were inspected; strict
containment passed with zero active handles. Artifacts have a unique run folder.

The isolated fixture now sets Next.js page workers to two in its copied config.
CPU affinity alone left 23 workers and sustained memory pressure; the fresh
bounded build and all browser checks pass without increasing timeouts. The
production Next.js configuration is unchanged. The failed request trace, earlier
build timeout and fixture-specific build-reuse failure remain retained evidence.

The restored release image has separately proven healthy startup and installed
MCP saved-memory persistence across image replacement and an ordinary restart.
It predates this reconnect repair. Final settled-source image, production
adoption, real chat behavior and reviewed release publication remain required.
The branch remains `context-upload-hardening-opencode-1.18.9` on the existing
`https://github.com/jtmb/ingenium.git` remote. This feature alone does not complete
the release. Private logs and identifiers remain in the local release companion.
