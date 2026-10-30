# Bounded Source descriptor hashing follow-on

This source-only proposal batches Source file reads in eight async lanes inside canonical Native `tools/reviewed-cargo-check.mjs`. It is for a **subsequent** coordinator gate. The running frozen `6c5a4c2d9fcf4b67fc9b109303f60fa632fabd45` gate and Native files were not read, modified, interrupted or queried by this follow-on.

Exact canonical preimage: SHA-256 `e5addff789c056feafd4c188a641f2d8987e586be15cdc0e07672869150a18f6`. The new minimal patch is `native-source-hash-batching.patch`; `native-source-hash-batching.json` records its bytes/hash, resulting module hash and unchanged descriptor/cache checks. No second full module snapshot is retained. The helper source and exact-preimage patch generator regenerate the delta from the existing owned canonical proposal baseline.

## Behavior

`sourceState` keeps its original Git checks, tree capture and default lexical `.sort()`. Each dispatched reader still runs the original `safeRelative` check and the original `hashFile(root, path.join(root, name), 67108864)` with its bounded descriptor reads, path/symlink checks, before/after identity/race checks, EOF check and `finally` close. That descriptor implementation is byte-for-byte unchanged.

`hashSourceFileBatch` captures the names once, launches at most eight async reader lanes and stores each `[name, result]` at its original input index. Completion order cannot reorder the file inventory. The existing digest function therefore returns exactly the sequential digest for identical names and file bytes. There is no extra sorting, metadata normalization, changed buffer size, skipped file, cached result, Source mutation or wider input permission.

When a read rejects, the scheduler stops assigning new files. Already-started reads finish normally through their existing close paths; the batch waits for all of them before returning or rejecting. It does not cancel a descriptor read, kill anything or leave rejected promises unhandled. If several started reads fail, the error from the lowest sorted input index is rethrown unchanged. Because earlier indices have already been dispatched, this preserves the sequential first-refusal choice while allowing their close/race checks to finish. A synchronous path/reader failure also refuses without assigning more work. Even a falsy rejection remains a rejection.

Only Source hashing changes. Cache traversal/hashing stays sequential and byte-for-byte unchanged. Receipt selection/approval, staged-tree/policy binding, source verification before/after use, physical aliases, flags/toolchain/config checks, original PowerShell guard and its 2 GiB + 256 MiB reservation, generic 4 GiB paths, and fixed compiler argv are unchanged. No new environment setting or caller-selected concurrency is added. These are eight async I/O lanes, not new OS threads, agents or compiler processes.

## Validation and integration

Twelve new CPU tests use real asynchronous delays and in-memory descriptor ownership counters; no filesystem fixture is created. They demonstrate maximum active readers of eight, overlap, all started handles closed before resolution/rejection, original sorted-order/sequential digest, exact-error identity, multiple late failures, synchronous/falsy rejection and immutable name capture. They also reconstruct the delivered patch entirely in memory and confirm exact after bytes, syntax and unchanged existing policy/refusal functions. The existing eighteen entry/refusal cases run alongside them. No real Native capture, storage guard, compiler, filesystem performance benchmark or current gate progress query was run.

The patched module was syntax-checked and evaluated only to define its functions; no capture/execution export was called. The generator compares the old/new descriptor and cache sections exactly. In-memory patch application was used instead of creating a temporary checkout or touching the running Native source. Root remains responsible for the eventual real apply/check and timing observation.

After the current stage completes, Root can independently review and apply the delta only to the exact e5 preimage. A changed preimage refuses and needs a new scoped review. Installing the patch changes the canonical module's own tracked bytes and therefore changes the next staged tree/Source digest: create a fresh current review receipt for that next gate. The equal-digest property applies to an identical file inventory, not permission to replay the current stage's receipt after editing Source.

No actual throughput improvement is claimed yet. The host filesystem/Node I/O implementation may limit achieved parallelism; the first later coordinator capture supplies real timing evidence. The proposal does not change cache hashing or raise concurrency beyond eight to manufacture a timing result.

## Reconciliation

Six small durable owned files are retained: async helper, patch generator, tests, minimal Native delta, hash metadata and this guide. Their remaining consumer is independent Root review and the next authorized Native gate; regeneration uses the exact existing baseline and generator. The current status receipt stays in the original coordination directory. No scratch, filesystem fixture, dependency copy, cache, compiler output or new root was created. Removed paths: none; removed bytes: 0. Every prior protected cleanup target remains untouched. No Windows/Linux space recovery is claimed.
