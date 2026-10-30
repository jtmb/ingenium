# Historical replay API review after 3deb6729

This is a bounded source proposal for Root's schema8 semantic review. It does not
change any production source, dependency feature, historical migration, DDL,
runtime limit or execution authority. The four quota8 proposal files stay frozen.

## Actual pinned dependency and integration prerequisite

Native's root Cargo.toml pins rusqlite 0.40.2 with bundled and backup. Adapters
inherits that dependency; its dev declaration adds hooks. None enables blob.
The cached crate's default, bundled and backup features do not enable blob, and
src/lib.rs gates the public blob module behind that feature. Root would need to
enable the actual pinned blob feature or implement a separately reviewed bounded
representation. This review does not silently make that dependency change.

inspect_replay_api.py verifies the existing local archive against the actual Cargo.lock
checksum and compares four cached API sources byte-for-byte with that archive,
in memory, without extraction or downloads. api-review.json records hashes and
finite source predicates. This is not compiler, SQLite behavior or memory proof.

## Connection, byte and response ownership

Connection::blob_open takes actual database/table/column names, an i64 row ID and
a read_only flag. Blob<'conn> borrows its Connection. It is not a detached byte
owner or authority-bearing receipt. Moving a ProjectStore Arc does not erase the
borrow or make this handle a static reqwest Reader. Do not use unsafe lifetime
extension or a self-referential moving connection wrapper to evade that fact.

A candidate implementation can keep the connection and Blob within one actual
owner's lexical worker scope. A private bounded handoff transfers already-charged
immutable pages to the request/response consumer. The queue, worker stack, hash
state and page descriptors also need bounded reservations. Reserve before opening
or reading, not after obtaining a full row. A fixed queue capacity is insufficient
if a consumer can retain arbitrarily many distinct delivered pages. Every live
page allocation remains charged to the shared runtime pool until its last owner
drops, including response copies and replay cursors. Backpressure and cancellation
must not detach that worker or manufacture an EOF/positive publication.

The actual read_at API writes into a caller-owned mutable slice and limits the
native read length to the smaller of remaining BLOB length and destination size.
read_at_exact rejects a short fill. Use a pre-reserved destination and checked
offset/length math. This API observation does not bound SQLite's page cache,
connection memory, journal/WAL growth, native allocations or HTTP buffering.
Those require their own configured budget and actual qualification.

## Authorization, snapshot and forget ordering

Start with the actual authenticated operation, current writer identity, current
forget/revocation state and exact publication/source provenance. A row ID, hash,
terminal marker or caller-supplied scope is never that authority. Select metadata
and open the exact row under one reviewed transaction/snapshot protocol, validating
type, logical length, representation version and committed exact hash. Keep that
same snapshot through a bounded hash prepass and transfer, or transfer a genuinely
verified immutable representation. Reading a changed row after a valid prepass
cannot inherit the earlier hash witness.

Forget ordering needs an explicit linearization point, not an informal flag read.
One candidate protocol checks/revokes per-operation read authority at each page
handoff under its real gate. After forget wins that gate, no further pages enter
consumer custody. Bytes handed off earlier stay charged until their actual owners
drop; they cannot be recalled by deleting a row. Do not hold a global application
lock over a slow network or an indefinitely blocked receiver. The chosen snapshot
may pin database/WAL storage; bound its duration and account for that storage, and
define concurrent delete behavior with real SQLite fixtures before acceptance.

Do not reuse Blob::reopen as a shortcut across operations: a new row needs new
authority and exact validation. Cold restart has no proof of old physical close
and must not reconstruct replay/execution authority from durable metadata.

## Checked close is separate from freed bytes

Blob::close(self) exposes the close result. Blob Drop calls close_ and discards
that result. close_ calls sqlite3_blob_close, clears the pointer, then returns the
connection's decoded result. Thus a failed explicit close consumes this handle;
it does not justify a retry through Drop/reopen or a success witness. Preserve the
failure and deny the relevant positive retirement predicate. A wrapper must
reconcile ordinary exit, read failure, cancellation and worker panic, and retain
an explicit failed-close/unknown status where a result was not observed.

Closing a BLOB is not ending a connection, joining a worker, ending reqwest,
releasing retained Windows handles or ending the engine job. Last-byte-owner Drop
can release its allocation charge independently, even while a physical-resource
or close-failure fence remains. Conversely a successful BLOB close cannot uncharge
a still-live response/page. Preserve these separate ledgers from 3deb6729.

## Required counterexamples before integration acceptance

- A response holds an old page while the producer finishes and closes the BLOB:
  the page remains charged, and another page allocation can still refuse.
- A consumer abandons a full queue while the producer is reading: cancellation
  unblocks the worker, a real join is observed and the close result is recorded.
  Failed or missing join never becomes successful on retry because its handle
  disappeared.
- The row is replaced, deleted or forgotten between metadata selection, prepass
  and a later transfer: no mismatched bytes inherit a prior hash or authority.
- Explicit close returns failure, or panic reaches Drop without a checked result:
  no physical-success witness is minted, even when all resident pages are freed.
- More than 4096 historical keys, a large single BLOB and many response consumers
  preserve exact history/no-replay while actual active page allocations remain
  bounded. No full-row Vec or SELECT substr memory assumption substitutes for it.
- Full ordinary 20MiB Windows URI, inline and WSL cases preserve exact source,
  wire and ACK with measured complete peak, including SQLite/HTTP/metadata budgets.

## Output and cleanup receipt

Owner: Work UI worker. One existing authorized output root is
/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845 on the C-backed
Ubuntu VHDX. This subdirectory contains only this review, its inspection recipe
and a minimal hash receipt. Run with Python -B and TMPDIR set to the existing
coordination/work-ui directory. No compile, install, database or runtime occurs.

Regenerate from the same root with:

    env TMPDIR=<root>/real-gmail-ui/veyra-phase-1/coordination/work-ui python3 -B inspect_replay_api.py --native <root>/real-gmail-ui/veyra-phase-1/windows-source --registry /mnt/f/Veyra-Dock-build/cargo-cache/registry

Consumer: Root's exact semantic/API/dependency review before any integration.
End condition: retain minimal durable source and pinned evidence through that
review. Existing user source, lockfiles, research, caches, builds and immutable
checkpoints are protected. Removed paths: none; removed bytes: 0. No bulk outputs,
disk databases or disk recovery claim.
