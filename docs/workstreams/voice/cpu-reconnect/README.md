# CPU request ownership and reconnect protocol v2

Source implementation and native adapter proposal; no service, model, device,
inference, dependency installation or native build was activated. The existing
explicit v1/local behavior remains separate. Windows-native and Linux API-owned
supervisors can implement the same port over their **existing Speech/Voice and
process authority**. No second journal, transcript store, DB or agent loop exists.

## Exact request and proof

Every v2 request uses this closed identity, with no aliases or inferred fields:

```json
{
  "instanceId": "operator-selected-instance",
  "bootId": "worker-boot-uuid",
  "ownerId": "supervisor-original-process-lease-uuid",
  "ownerGeneration": 1,
  "requestId": "original-native-speech-uuid",
  "operationId": "same-original-native-speech-uuid",
  "generation": "original-attempt-uuid-retained-before-dispatch",
  "kind": "transcribe",
  "digest": "64-lowercase-hex-sha256"
}
```

UUIDs must be canonical lowercase/non-nil. Owner generation is an integer 1–2^53−1.
The original service owns request/generation creation and retains the tuple
before any reserve/execute call. Reconnect loads that exact tuple, never creates
a new generation or prompt/session to try again. Payload digest is SHA256 of
ASCII kind, one NUL byte and **exact outgoing body bytes**: raw PCM for
transcription, exact UTF-8 JSON bytes for synthesis. No JSON reserialization,
normalization or private text/audio is stored by the worker owner. Shared Python,
Node and proposed Rust vector: `transcribe\0fixture` hashes to
`510701dc62875afbcb25e60d5329d7af23278177905e9742fd600f0a92aa79ee`.

Authenticated private endpoints:

| Endpoint | Body and effect |
| --- | --- |
| POST `/v2/operations/reserve` | Exact identity JSON, at most2048 bytes; enroll metadata once, never run inference. Same identity returns original state; changed digest/generation/kind conflicts. |
| POST `/v2/transcriptions` | Existing bounded8000–480000-byte mono16k s16le PCM; exact identity in one `X-Veyra-Identity` JSON header. |
| POST `/v2/speech` | Existing bounded JSON `{requestId,text,voice}`; exact identity in one header. Existing600-scalar/2400-UTF8 and15s output bounds remain. |
| POST `/v2/operations/observe` | Exact identity JSON; return original state/proof. May retry durable finalization of an already-returned scope, never inference. |
| POST `/v2/operations/cancel` | Exact identity JSON; set only that original flag. ACK is nonterminal for a running request. |

The HTTP framing owner accepts v2 PCM's actual size, rejects duplicate identity,
authorization/content-type headers and conflicting/missing lengths, and authenticates
before reading bodies or touching the owner. DirectML rejects v2; its frozen
model/control source is unchanged. Legacy v1 cancel cannot invalidate a new
v2-owned job; the v2 job uses its original Event, not an expiring v1 tombstone.

Proof is closed metadata `{identity,state,outcome,drained,retentionId}`; cancel
adds `accepted:true`. It carries no transcript/audio or response replay cache.

| State | Proof and allowed interpretation |
| --- | --- |
| reserved | `drained:false`; no inference yet, but later execution is not sealed. Missing state is not an equivalent proof. |
| running | `drained:false`; cancel may set the original cooperative flag. ACK/health/idle/timer cannot retire it. |
| terminal | `drained:true`, exact identity, recognized outcome and native/API durable transition UUID are all required. |
| uncertain | `drained:false`; retain quarantine. Unexpected callback/authority/retention failures do not invent a terminal result. |

A reserved cancel seals all future execution of that UUID before retaining
`cancelled-before-dispatch`. The executing synchronous Application callback
returns only after the actual `_job` finally/CPU scope returned; then the owner
retains `completed`, `failed` or `cancelled`. Native/API journal retention is
required before the proof is exposed. A transient lost commit acknowledgement
can be finalized again only from the same worker's already-returned positive
scope candidate; the privileged port returns the **same** committed retention
UUID. No inference repeats. An authority fault remains latched even if health or
the port later responds. A restart loses candidates and cannot manufacture them.
If retention fails before the work callback is entered, the original is sealed
against later dispatch; observation may retain only that positive no-start proof,
never retry the work. Until that durable terminal is confirmed it stays quarantined.

Proof concerns **that original request only**. Another v1/v2 request may own the
worker; one failed-busy request's no-start proof is not worker/process retirement.
Native helper threads and process trees still require their own positive joins.

## Required supervisor port: real integration gate

Python `SupervisorOwner` and the Node/Rust ports have no production default,
file/PID/health fallback, or HTTP enrollment endpoint. `prepare(...,cpu_owner=...)`
can accept an actual owner supplied by the supervisor; ordinary v1 CLI startup
does not implicitly enable v2. V2 without that owner returns503. The existing
Windows-native or Linux API process supervisor must supply:

1. **Original process enrollment.** `enroll(instance,bootChallenge)` binds this
   challenge to its actual original child/process/job capability and monotonic
   owner generation. Use the authenticated original child channel, not a boot
   string supplied by an arbitrary HTTP client. The supervisor retains the real
   scope identity/custody; a PID, launch timestamp, lock, missing socket or random
   UUID is not that authority.
2. **Existing durable operation binding.** Before reserve/dispatch, retain this
   tuple under the already-admitted native/API Speech original and atomically
   claim the workflow once. Windows retains existing file/ACL custody; Linux API
   uses its existing owner. No parallel journal is requested. `retain(identity,
   state,outcome,drained)` admits only closed valid transitions from that exact
   authenticated original worker scope and returns the committed transition UUID.
   A repeated identical commit returns the same UUID, including after an IPC ACK
   was lost. A changed tuple or spent UUID cannot rebind on another boot.
   Quarantine/finalization calls must not overwrite an already valid terminal
   original when a duplicate caller attempts to start it again.
3. **Cleanup capability after ordinary revocation.** `validate(lease)` checks
   original scope identity/fencing, not current selected model or a newly granted
   task capability. Finalization/cancel/observe must remain scoped and available
   after ordinary admission is revoked. Never hold a global Speech/Voice mutex
   across worker IPC that reenters this retention port; serialize short original
   mutations under the existing owner instead.
4. **Positive prior-process retirement.** Replacement generation requires actual
   original supervisor capability evidence that the owned child/tree has exited
   and joined. Native Windows uses its real retained process/job custody; Linux
   API uses its real retained supervisor/owned-tree completion. This worker does
   not implement or qualify either primitive. Restart, missing PID/state, idle,
   elapsed time, a cancel ACK or caller `verified:true` cannot substitute.
5. **Independent acceptance.** `acceptTerminal`/`accept_terminal` matches exact
   identity and worker transition against its own durable original/lease before
   remote-request retirement. Copying a response into a bare success boolean is
   refused by clients and is not an implementation of this port.

The coordinator explicitly owns this real port/process/job/journal composition.
There is no claim that it already exists. This is the concrete remaining blocker
for actual v2 activation/restart qualification; Windows source-only support does
not silently remove the Linux supervisor path. Keep live voice/reconnect, real
asset/CPU runtime, credentials/races, audio/latency/devices and full release gates.

## Bounded state and lost results

The worker keeps at most 256 metadata records by default (explicit maximum 1024),
including spent terminal identities. It never evicts any unresolved operation,
never uses TTL eviction, and refuses new reservations at capacity. Capacity does
not authorize purging a journal or replacing a live worker. Rotation requires
the actual prior-process retirement above and preserved original/tombstone
ownership in the existing supervisor. No text, WAV, bearer token or private error
message appears in proofs/debug/access logs.

The Node `CpuOwnershipClient` requires the supervisor's one-shot original permit
before reserve, never creates request/generation IDs, and never retries execution.
On a lost response it retains quarantine. `reconcile` only observes the exact
original; running/missing/mismatched/oversized proof cannot clear it. A terminal
proof can retire remote work even if the result bytes were lost, but returns
`resultAvailable:false` and never fabricates a transcript/audio/successful replay.
Fully received bytes still need the existing native/service text/WAV validation.

The native proposal adds explicit v2 entry/reconcile methods and typed proof/owner
ports. Default v1 dispatch/configuration/custody is unchanged. It deliberately
does **not** supply a fake supervisor implementation or clear a global quarantine
latch. Coordinator composition must retain/load the binding in the existing
operation, handle exact terminal outcomes before the generic cancel flag, validate
any result bytes, and persist its original result/proof before retirement. A lost
completed result can be represented as result-unavailable with the actual remote
completion provenance; it is not a successful transcript and cannot be replayed.
Other unknown originals, failed native helpers or retention faults must keep the
owner quarantined. Only after every applicable original has authoritative proof
and original helper join may the existing owner recompute its admission gate.

## Exact proposal and model-free checks

`native-cpu-reconnect.patch` targets coordinator staged **tree**
`268acab8c5dcf14ab188ecd8fdcbb21c9316179b`, not an inferred HEAD. It changes only
`speech.rs` module declaration, adds `speech/cpu_reconnect.rs`, and adds explicit
v2 transport methods to `speech/http_worker.rs`. Native files/index are read-only.
`make_patch.py <native-checkout>` uses Windows Git show of that exact tree and
records raw pre/postimage hashes. No build/install/download occurs. Three Rust
model-free tests are proposed, not compiled/run by this worker.

With `PYTHONDONTWRITEBYTECODE=1` and TEMP/TMP/TMPDIR all inside the existing phase
`coordination/voice` root:

```text
python -B packages/veyra-voice/speech-worker/tests/test_cpu_ownership.py
node packages/veyra-voice/cpu-ownership.test.mjs
python -B docs/workstreams/voice/cpu-reconnect/make_patch.py <native-checkout>
```

Windows Node's `--test` UNC path discovery refused the file before executing;
direct `node <absolute-test-file>` runs the same registered node:test cases.
Python/Node tests use explicit fake supervisor/model ports and in-memory HTTP
handlers/Responses. No socket/process/model/device is started. They cover exact
identity/digest/generation, real handler finally/framing, cancellation before and
during scope, dropped result/commit ACK, no replay, capacity, missing/restart,
durability/authority failure, per-request versus whole-process retirement, legacy
v1 separation and shared cross-language digest. Logs are minimal current evidence
under `coordination/voice`; no scratch/cache/dependency/model/audio output exists.
Sources, exact patch/recipe/manifest and those logs are retained for coordinator
review/real owner integration. No deleted paths/bytes or disk recovery is claimed.
