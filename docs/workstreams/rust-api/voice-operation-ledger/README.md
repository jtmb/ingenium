# Hosted Core voice operation foundation

This is a docs-only proposal for reserved SQL128 and the first concrete hosted/Linux voice operation ledger on the original Core connection. It does not install migrations, register HTTP routes, start a supervisor, invoke Python/FFI/models, or create a second database/journal. Windows Native retains its existing Rust Speech journal; the Core context must explicitly report hosted mode.

`contract-v1.ts` and `contract-v1.md` are the frozen Root/Worker7 interface. `voice-operation-ledger.ts` owns authenticated admission/public revision CAS; `voice-operation-cpu.ts` owns the private CPU ACK/resource fields on that SAME row; `voice-operation-owner.ts` binds existing getDb/execTransaction/checkpoint. Public, CPU producer and private bookkeeping revisions have separate meanings. All callers are server-side owners; Root must expose a deliberately limited HTTP DTO rather than serialize private owner/control/CPU metadata to a renderer.

Required authorities have no defaults: actual request-selected scope/auth/CSRF/account/conversation/agent/execution authority, held original Node capability authority, and actual positive retirement proof authority. Async network or physical joins occur outside Core SQL, followed by synchronous validation of actual held proof tokens. Tests inject these authorities; no production binding is claimed. The current VoiceService reserve ports lack original UUID/input digest/owner fields, so Root's real adapter must compute and bind those before dispatch. No fallback IDs, conversation lookup, native-to-hosted mapping, credential or inference authority is invented here.

The source tests use real SQLite and this exact proposed implementation. The finite cases include two actual connections, busy admission, stale revision, one-shot and lost dispatch permit, lost/historical CPU ACK, reserved-repeat and uncertain ACKs, current API scope/SQL revocation before FFI, body fingerprint order and immutability, terminal/public-unknown separation, private positive retirement after UI shift, one hot scope/control replacement and monotonic owner generation. Validators are compared with the actual portable session/CPUv2 source. This remains inert source qualification, not a running supervisor, physical retirement, actual Express auth or production migration test.

The file-backed case closes every SQLite connection and opens a fresh Core ledger over the same database. A reservation committed before its checkpoint response was lost remains spent, and a lost CPU transaction ACK returns the identical retained UUID/revision after cold reopen. The fixture's authority callbacks remain explicit stand-ins; this proves persisted ledger semantics without claiming a real process crash or physical-owner recovery.

Strict/noUncheckedIndexedAccess checks use the existing installed TypeScript library entirely in memory, with declared original Core DB signatures. No compiler outputs, cache or dependencies are generated. Root must still typecheck and test the installed full Core/API and original Node supervisor composition.

Regenerate from the owned checkout with the SAME declared C-backed WSL coordination output root:

```sh
export NODE_DISABLE_COMPILE_CACHE=1
export TEMP="$OWNED_COORDINATION_ROOT" TMP="$OWNED_COORDINATION_ROOT" TMPDIR="$OWNED_COORDINATION_ROOT"
export VOICE_LEDGER_INTEGRATION_ROOT="$EXISTING_INTEGRATION_CHECKOUT"
export VOICE_LEDGER_TEST_ROOT="$OWNED_COORDINATION_ROOT/voice-ledger-fixtures"
node docs/workstreams/rust-api/voice-operation-ledger/prepare-proposal.mjs "$VOICE_LEDGER_INTEGRATION_ROOT"
node docs/workstreams/rust-api/voice-operation-ledger/verify-proposal.mjs "$VOICE_LEDGER_INTEGRATION_ROOT"
node docs/workstreams/rust-api/voice-operation-ledger/check-types.mjs "$VOICE_LEDGER_INTEGRATION_ROOT"
node --experimental-vm-modules --test docs/workstreams/rust-api/voice-operation-ledger/voice-operation-ledger.test.mjs
```

`core-voice-owner.patch` proposes six canonical targets against `f86aec9e37df71aae0f3368561669982884c3b15`; five are new, and the Core barrel is additive. `preimages.json` records exact old/new hashes and actual portable contract hashes. The independent verifier applies every hunk in memory and checks all resulting bytes/hashes. Root must compare current preimages and review drift before applying. Root owns SQL128's migration registration and runtime application.

Generated SQLite paths stay inside the declared coordination root. Both connections close, ownership/non-link/single-link/inactive-handle checks pass, then exact fixture files and empty scratch are removed; `voice-ledger-cleanup.json` lists paths and measured logical Linux bytes. Final receipts and unique failure evidence remain for Root's integration review. Prior protected Windows EBUSY and policy-rejected outputs remain untouched. No Windows disk-space recovery is claimed.
