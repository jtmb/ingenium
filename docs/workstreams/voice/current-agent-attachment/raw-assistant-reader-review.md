# Original bounded raw assistant reader proposal

Worker-owned sources only; Root applies canonical changes and runs tests/builds.
No engine/runtime/model/CU/build/test execution or shared source changes occurred.

## Pinned protocol and corrected provenance

Read primary2.0.11 commit9eb6902aaf3c35ce985b67c605a775992249066b sources:
[session protocol](https://raw.githubusercontent.com/anomalyco/opencode/9eb6902aaf3c35ce985b67c605a775992249066b/packages/protocol/src/groups/session.ts),
[public message union](https://raw.githubusercontent.com/anomalyco/opencode/9eb6902aaf3c35ce985b67c605a775992249066b/packages/protocol/src/groups/message.ts),
[assistant schema](https://raw.githubusercontent.com/anomalyco/opencode/9eb6902aaf3c35ce985b67c605a775992249066b/packages/schema/src/session-message.ts),
[session handler](https://raw.githubusercontent.com/anomalyco/opencode/9eb6902aaf3c35ce985b67c605a775992249066b/packages/server/src/handlers/session.ts).

GET /api/session/:sessionID/message/:messageID returns {data:PublicSessionMessage}.
The handler verifies session existence and uses the two route parameters to read
the message. Assistant has actual id/type/agent/model/content/time. The response
does NOT contain a native sessionID field. Pinned text content has type/text and
optional state, NO native text-part id. Tool content has an id but is not speech.
Record exact content index and nativePartId:null; unexpected text id or nested
session field refuses as drift. Corrects prior contract's optional native text-id
assumption for this specific pinned protocol; do not invent or map one.

The existing client maps missing text IDs and emits a synthetic step-finish.
This new path bypasses that mapper completely. Optional completion/finish and
tool/reasoning contents never become speech or goal/engine settlement evidence.

## Concrete source changes

raw-assistant-wire.mjs/.d.mts are new pure parser/wire DATA primitives copied to
API lib/voice-v2. raw-opencode-client.additions.ts appends real HTTP owner methods
to actual opencode-client.ts; exact import/append recipe is in
raw-assistant-reader-splices.json. Append edits reference afterFile+SHA256+prefix
to avoid duplicating whole source in the recipe. Apply descending with exact
original bytes, reference-file hash and proposed whole-source postimage checks.
Existing request/client/SSE/default typed/synthesis paths are untouched.

The new method accepts selectors/deadline/real cancellation only. It uses actual
currentOpenCodeRuntimeTarget, original credentials and encoded directory header.
No caller URL, fetch, auth, response, text/hash or positive proof port exists.
The original Node fetch binding is captured once at module initialization;
later global fetch replacement does not replace this method's retained binding.
The new method requires a scoped original target; it does not infer default
installation identity from configuration. This restriction is local to new read.

Exactly three GETs: bounded session before, bounded assistant message, bounded
session after. Path components must be native-shaped ses_/msg_ identifiers; URLs
use captured origin only (no base path/query/userinfo/hash). Agent ID uses pinned
string semantics with finite scalar/control bounds, not a guessed ID prefix.
Bookends validate same session/directory/selected agent/model/variant and reject
archive/revert. Message validates exact ID, actual assistant agent/model, bounded
content/text. Bookends are observed checks, NOT an atomic engine-selection lease.
Future fixed producer must still validate its original call/plan before/after
the read and immediately before same-Core134 admission. HTTP provenance alone
cannot supply authorization or immutable call generation.

One end-to-end absolute deadline <=10seconds, same AbortController across all
requests; caller abort/deadline propagates into fetch and exact original body
reader cancellation. No automatic retry, alternate path, redirects, cookies,
default target or cached/mapped fallback. Status must200; type application/json
with optional UTF8 charset; encoding absent/identity (request asks identity).
Response final URL must exactly match requested URL. Declared and consumed bytes
must agree if length exists. Any status/type/header/path/bound/decode/cleanup
failure cancels/joins original body and mints NO original handle. Errors are
fixed RAW_* codes; upstream body/credentials are not logged or echoed.
The10second deadline stops successful acquisition and initiates abort; it does
not invent a finite cleanup proof if the original cancel Promise cannot join.
That call remains pending with its capacity slot held, or rejects cleanup-unknown;
no timeout race releases an unjoined body as a successful observation.

Before/after session bodies <=128KiB each, message <=1MiB, <=256parts, all spoken
text combined <=32000scalars/128000UTF8bytes, JSON depth<=32/tokens<=65536. Strict
JSON refuses duplicate keys at any depth, malformed UTF8/BOM, non-finite number,
unpaired surrogate and syntax/complexity drift. It does not silently normalize
strings. Only actual text parts are extracted; unknown part kinds refuse,
reasoning/tool parts are retained solely in the exact raw body, never spoken.
Validation is of required speech provenance fields, not every opaque tool-state
field or every optional upstream metadata schema. Do not claim full schema decode.

Exact identity-encoded response ENTITY bytes and SHA256 are retained, along with
both bookend bodies/hashes and actual content indices. HTTP transfer framing/TLS
bytes are not captured. UTF8 range selection is pure DATA: exact original bytes,
scalar boundaries and SHA/prefix SHA, with CRLF/combining/BOM text preserved.
It creates no source row or authority. Redaction/plan/CPU digest remain separate.

## Opaque lifetime and unavailable producer

Only the real completed HTTP body owner creates the frozen empty opaque object,
stored by exact Map identity. EOF is required for every successful body. JSON
copies, casts, parser outputs, response/body hash DTOs and fixture Responses
cannot enter that Map. take consumes it once and copies raw byte arrays; discard
explicitly disposes it. Retained raw contents expire at the original <=10second
deadline, with unref'ed disposal timer. Maximum4 pending+retained reads. No
unbounded cache, transcript database, timers beyond read expiry or background jobs.

Returned read DATA is not a new capability to authorize TTS/observation. The fixed
observation producer must itself invoke and consume this raw read under its
private original call and plan, never accept a caller-supplied returned DTO.
raw-request-context.additions.ts adds that named constructor as UNAVAILABLE:
it checks the real private context/current selected content/speech authority,
then refuses before any network/Core effect because RecordContext has no original
active call incarnation/generation or immutable speech plan. No fake callback,
agentCompleted, synthetic source, hash approval or retired agent row substitutes.

Root must implement genuine private call+plan owners, full before/after/admission
checks, Core134 metadata/claims/tombstones and proper read disposal when caller
checks fail before activating that producer. Existing CPU resource admission,
result/retirement, agent paths and inactive global fence remain unchanged.

## Verification, memory budget and remaining gates

13 authored node:test DATA fixtures cover bytes/hash/EOF, unfinished assistant
content, strict JSON/Unicode/depth/token bounds, status/path/redirect/encoding/type,
declared/actual body limits, read/cancel failures, pending and pre-start abort,
session/model/agent checks, mapped/native identity drift, text/part limits,
nontext exclusion and exact UTF8 ranges. They use only finite Response-shaped
fixtures and ReadableStreams, never inject a successful fetch into actual owner.
5 additional Vitest negatives target actual canonical client/context functions
for forged/serialized handles, absent target, invalid selectors/deadlines/DTO,
cancel-before-start and forged private context. No positive auth/model fixture.
Neither suite was executed by worker. Root commands after reviewed integration:
`node --test raw-assistant-wire.test.mjs`; API Vitest negative suite; strict API
types plus original-client regression; then genuine bounded HTTP owner checks.

Unexecuted tool-V8 body syntax parse covers .mjs files only, not TS compilation.
Root must qualify actual Node fetch/body cancellation/deadline/one-use provenance
and memory peak before any release claim. Four retained responses hold at most
5MiB raw bodies (message+two bookends each) plus <=512KiB spoken UTF8 text total;
parsed object/string/working-copy overhead is additional, bounded by input/token
limits, and unmeasured here. No durable raw body/text is stored or Core grant made.

The same original task-owned source root/volume is retained; source budget was
amended before generation to262144B within original64MiB source allowance and
combined20GiB task ceiling. No runtime outputs/cache/temp/dependencies created;
removed paths0/bytes0. Minimal sources/recipe/receipts retained for Root's remaining
actual integration/verification consumer.13older Native drafts stay protected.
All call/plan/Core134/restore/audio gates and full parent scope remain open.
