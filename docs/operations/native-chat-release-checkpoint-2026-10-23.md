# Native chat release checkpoint — 2026-10-23

## Accepted source changes

The browser fixture now implements the pinned native OpenCode 2.0.11 API,
including split catalogs, location-bound sessions, prompt admission and global
native events. It rejects legacy routes and assigns unique session IDs across
resets so persistent checkpoint receipts cannot collide between tests.

The API preserves the native user-message ID returned at prompt admission. The
dashboard uses it to replace the exact optimistic message before an authoritative
snapshot arrives. This fixes duplicate user prompts that previously disappeared
only after reload. Chat project controls now shrink within available mobile
header space while settings and account buttons retain their size.

Browser tests now verify a real saved turn survives password login and reload
without duplicate messages or checkpoints. They also assert session title
updates, desktop/mobile rendering and non-overlapping mobile header controls.

## Verification

- Native fixture: 7 tests passed, including title PATCH and unique reset IDs.
- API route contracts: 58 passed; dashboard chat hook: 69 passed.
- API clean-core and dashboard TypeScript checks passed after the message-ID fix.
- Browser run `c60ba323-4608-4fe8-8217-eea68abdca83`: 10 selected chat,
  provider-state and task-capture tests passed; strict containment exit 0.
- Final desktop/mobile run `b5d79353-66cf-4d94-a642-e0d9e2711394`: the persisted
  session and rendering regression passed after title-PATCH and layout fixes.
  Both 1440x900 and 390x844 screenshots were inspected. Strict containment exit 0,
  active handles 0. Screenshots and runner telemetry are retained as local test
  artifacts; synthetic fixture responses are not evidence of a real model call.
- Diff whitespace checks passed. The checkpoint paths were clean in the initial
  preservation manifest; unrelated pre-existing changes remain unstaged.

## Remaining release work

The full Ingenium release goal remains active in the current Codex chat. No
OpenCode development or successor chat is used. This checkpoint does not qualify
production startup, installed profiles, real memory save/update/forget,
simultaneous sessions/restart replay, identity/tenancy or final publication.
Continue with lifecycle diagnostic isolation and settled source/build review,
then exact-source deployment and the original runtime acceptance gates. Preserve
production data, private backups, rollback images and historical failure evidence.
