# Native Memory store and refusal qualification source

Owner: memory worker 01a18935-0219-7cc0-88be-368fa7fa330c.
Source checkout and output root remain the existing approved C-backed Ubuntu
VHDX task roots. No compiler/runtime is invoked by this worker. Root applies and
runs the actual Native tests using its original 20 GiB/15 GiB reserve and lease
guards; this source milestone does not close genuine lifecycle acceptance.

All on-disk synthetic fixtures require process-scoped
`VEYRA_MEMORY_NATIVE_TEST_ROOT` set to the existing approved output root. There
is no TEMP or drive fallback. Generated children are
`<root>/veyra-memory-native-<UUID>/` with an exclusive owner marker. Tests use
the actual GoalStore and ProviderAttemptStore APIs, existing ACL helpers,
SQLite connection close and original migration transaction. Schema fixtures
use the actual older 0002.sql, not a replacement migration. A historical
yielded row is inert database data only; no Native cleanup receipt or
MemoryAttemptYielded is fabricated.

Twenty-five new tests: four GoalStore file/reopen/receipt/fresh-chat/forget and
failure controls; seven real provider-store persistence/migration/nonreplay/
rollback controls; three original shared queue refusal/ownership controls;
three original inhibited Source admission refusals; six original queue cleanup
census controls and two original provider cleanup controls. No engine/model/network/
GPU process or native positive retirement fixture is started. Run disk groups
serially. Synthetic disk data is conservatively budgeted at 16 MiB total;
compiler/test binary growth remains Root's independently measured envelope.

Runtime fixture cleanup is part of each test. After original store handles
close, the helper verifies canonical parent/child identity, owner marker,
non-symlink/non-reparse kinds and a complete known-output inventory before
nonrecursive deletion. It reports exact removed paths/logical bytes. Unknown
files, refusal or unexpected panic retain the exact fixture for Root diagnosis;
there is no alternate deletion attempt. Failure evidence consumer is Root's
first-failure review and safety reconciliation; successful reproducible fixtures
have no remaining consumer and are removed. No Windows recovery is inferred.

Use the existing qualified runner with these underlying selectors:

- `cargo test --locked -p veyra-adapters --lib goal_store::learned::tests:: -- --test-threads=1 --nocapture`
- `cargo test --locked -p veyra-adapters --lib provider_attempts::memory::persistence_tests:: -- --test-threads=1 --nocapture`
- `cargo test --locked -p veyra-service --lib inference::provider_queue::memory::refusal_tests::`
- `cargo test --locked -p veyra-service --lib routes::provider::memory_admission::refusal_tests::`
- `cargo test --locked -p veyra-service --lib inference::provider_queue::cleanup::tests::`
- `cargo test --locked -p veyra-service --lib routes::provider::queue_cleanup::tests::`

The required source fix separates cleanup eligibility from retained ownership.
Opaque queue census construction checks the original Book, exact retained entry
sets, no dispatch reservation, known terminal phases and actual joined workers.
Service checks every prepared Task/retired Memory entry against exactly one
original acquisition, matching cancellation/grant/admission identity and actual
native/same-journal proof; refused entries cannot hide a matching acquisition.
No orphan acquisition or unrelated closed-task fence is accepted. Final census
readback refuses membership/phase/worker drift. `has_retained()` and every
retained row/proof remain unchanged. No supplied booleans or fake Native receipts.
The actual idle-engine detach caller supplies its already-validated original
CompletedEngineActivity rows and service owner to the same eligibility check.

An added negative original queue control also exposed that Task Unknown did not
fence can_start_memory/enroll_memory/reserve_memory. These reads now reject it.
The original Memory entry retains only a Weak link to its actual queue, avoiding
a cycle. Capture/prepare/claim/start refresh the same shared known-state fence;
native cleanup of an already-owned request remains separately permitted.

Genuine positive Memory queue/cancellation/retirement/
shutdown qualification stays with Root's actual registered engine/current
source/ready binding. Inhibited Source owners cannot mint that admission.
The existing queue ownership-as-cleanup blocker is addressed in source only;
Root must review/apply, compile and qualify its real positive lifecycle before
that acceptance gate can close.
Startup reconciliation remains explicit: preflight_retained_startup still uses
the historical ownership census but has no service/actual-row input for this
positive eligibility check. Root must compose its existing startup owner/census
constructor before claiming post-retirement model/task restart acceptance.
