# SQL132 and actual selected-state admission follow-on

Root ran the previous17 tests. The new4 SQLite and8 admission cases are unexecuted
source. Root applies/qualifies shared changes. Proactive-assistant name is exact
`veyra-bot`; compatibility IDs and Stratus remain unchanged.

## SQL132 correction before application

The same existing metadata table now uses WITHOUT ROWID, preventing an implicit
rowid UPDATE OR REPLACE from evicting another original. A BEFORE INSERT trigger
rejects an existing primary identity before SQLite's REPLACE conflict deletion,
including when recursive_triggers is0. It also refuses INSERT OR IGNORE collision.
BEFORE DELETE always rejects removal. updated_at must not precede created_at or
move backwards from OLD.updated_at. Existing identity/state/revision guards stay.

Tests cover both recursive settings and all three states, preserving originals
after replacement/delete/time refusal. Root also tests its actual Core writer/
migration. No DB was opened here; recursive_triggers is not a substitute guard.

## Concrete cooperating-API fence source

`selected-state-admission.mjs` is fail-fast API-process admission exclusion, with
no execution/wait queue. Private nested tokens reenter only the same original;
cross-owner/stale contexts refuse. Detached enrolled Promises stay joined before
release. Ambiguous writes retain bounded unknown slots, with no timer, eviction,
adopt/reset or GET-to-release path. No new chat/Run/model work is created.

`selected-state-binding.ts` is the concrete API adapter. Copy it and the mjs/
declaration source into `services/ingenium-api/lib/`. Every user of the fence
must import that SAME module instance. The identity is a server-owned logical
engine owner plus canonical engine session ID. Do not use nine-axis request
scope or directory as the lock key: two principals/scopes/directories can refer
to the same engine session. Do not derive authority or alias equivalence from a
browser URL, query or submitted ID.

Both genuine runtime middleware and private attachment target carry the same
`selectionOwnerId: runtime:{actual runtime.id}`. Default installation uses one
server-owned identity. Scoped targets lacking an identity refuse mutation;
hostname aliases cannot silently create independent locks. Actual auth/source/
backend-start checks remain in their private owner.

`selected-state-edits.json` supplies exact preimages and nonoverlapping UTF-16
edits. Verify hash/old text, apply descending offsets preserving untouched bytes/
EOL; receipt postimages were computed in memory. No shared edits/source copies.

The actual edits are:

- `lib/routes/opencode.ts`: typed POST /sessions/:id/prompt enters the shared
  owner around sendPrompt. Existing password/auth/body checks remain first.
- `lib/opencode-client.ts`: compound sendPrompt holds the same admission from
  initial session inspection through optional model/agent selection and actual
  prompt ACK. selectSessionModel holds GET/model POST/confirmation GET together.
  compactSession also changes model, so it is included. update/delete/revert/
  unrevert retain their complete compound session operations as well.
- The exported request wrapper classifies all mutating /api/session/{id} and
  /api/experimental/session/{id} paths, decodes the ID once to prevent encoded
  aliases and enters the SAME reentrant owner around the complete original
  request Promise, including response/body/error processing. It does not wrap
  only fetch headers. A known local missing-password refusal remains no-I/O.
- `lib/runtime-opencode-context.ts`: add the optional server-owned target
  identity and populate it only after actual runtime row/owner resolution.
- `request-context.additions.ts`: message/control wraps the entire private
  execution/source/manager/session inspection and its ONE actual callback send.
  It uses the same logical runtime/session identity, and sets that identity in
  the actual OpenCode target so low-level mutations reenter. Read-only event
  inspection/subscription and speech observations do not hold a long agent
  write lock. No GET-only positive fence is claimed.

New-session defaults use selectSessionModel once its ID exists; attachment
creates none. Internal Node client/request callers participate. Root must map
executeSynthesisBroker's scoped loopback target from its real runtime/job owner;
it currently lacks the new identity. No URL fallback. Audit every target and
direct mutation caller. Readonly snapshot/recall calls remain unaffected.

## Exact limitations: not a whole-engine or distributed fence

This source offers real exclusion among participating callbacks in ONE API
process. It does not establish engine-wide atomicity by itself. Before claiming
that a selected model cannot change before an attachment prompt, Root must
route every conflicting original writer through one authoritative admission
boundary, or retain the narrower coverage gate. In particular:

- Actual `scripts/opencode-auth-proxy.mjs:createProxyServer`, forward at lines65–70
  and request.pipe at lines80–100, forwards raw method/path/body straight to
  127.0.0.1:4098. It never calls this API client or owner. Nginx's dedicated
  OpenCode Web origins use that independent boundary. Importing the same JS
  module into a separate proxy process would create another Map, not one owner.
- Native `NativeWebOriginal::capture` validates and retains original bytes in
  `desktop_runtime/local_workspaces/web_original.rs`. That is capture, not a
  Node admission held through later forwarding. Native LiveRuntime/client and
  retained task control/model paths are separate Rust owners. A Node-only gate
  cannot silently claim their mutex, request, scope or process authority.
- Engine-internal Session/Plugin writes, background/subagent execution and CLI
  clients talking directly to an engine do not invoke this API process. A tool
  or event observation cannot fence those original writers.
- Global agent/provider/config/MCP/instruction registry mutation may affect
  multiple sessions; the per-session classifier does not claim that global
  coverage. It is not a mutable-registry lifetime or tool-census proof.
- Multiple API processes/replicas have separate Maps. Process restart also
  loses an in-memory unknown slot. SQL132 keeps message/control request IDs
  spent across restart, but that is NOT durable retention of every model/source
  mutation. Root needs the actual shared original admission owner/persistence
  and startup reconciliation for that broader guarantee. No new epoch, API
  restart, session GET or TTL may be treated as original-request retirement.

Therefore the actual remaining shared constructor decision is the single
authoritative private engine write boundary (API/proxy/Native/other callers)
and its retained/durable unknown admission owner. Route/coordinator integration
can use this source for its participating process immediately after review and
tests; full selected-state concurrency acceptance stays open until those other
writers are accounted for. This is not a reason to kill the persistent engine,
duplicate a queue/chat or relax existing original guards.

## Qualification and inventory

Coordinator command adds selected-state-admission.test.mjs to the prior three
test modules. It exercises compound selected inspection/model/send exclusion,
same-original reentry, detached original joins, stale-context refusal, unknown
retention, pre-effect auth refusal and encoded path aliases. This follow-on has
29 total authored cases (previous17 +4SQLite +8admission). No new tests were
executed by the worker; JS body parse and JSON/whitespace checks are narrow.
Root must run actual patched-client/routes/private-context tests, test blocking
selection changes during a real pending send, and test bypass/unknown/restart
cases against the actual selected authoritative owner before claiming coverage.

All generated files stay in the same existing C-backed task root. Follow-on
source budget98,304 bytes; combined20GiB task ceiling and15GiB reserves unchanged.
No dependency/cache/build/temp/runtime/model/device/CU output was created.
Removed paths:none; measured removed bytes:0. Retain minimal source, edits,
hashes and receipts for Root review/application/qualification; protected source,
earlier Native drafts and rejected cleanup targets remain untouched. No Windows
or Linux filesystem recovery is claimed.
