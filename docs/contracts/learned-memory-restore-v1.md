# Learned memory restoration

The existing Core maintenance owner now captures content-free learned-memory suppressions and committed forget/reset receipts alongside its explicit-memory deletion ledger. The original restore rehydration transaction merges both ledgers before returning a restored run. No separate database, writer, transcript, credential or scheduler is created. Runtime Core does not depend on API code.

The learned capsule has a bounded versioned body and digest. It rejects malformed/partial schemas, unexpected content fields, duplicate originals, altered bytes and conflicting immutable receipts. Restore unions suppression history, erases every matching active derivative in the same scope, and keeps metadata and original deletion receipts. It never replaces existing immutable history. The optional capsule field preserves maintenance journals written before learned memory shipped; new captures include it. The existing explicit-memory ledger remains unchanged.

Four focused SQLite cases passed using the actual migration 123 and actual lifecycle forget/reset producer, with explicitly minimal FK parent and authorization fixtures. They cover older restored content, shared-source derivatives, foreign scope preservation, exact receipts, replay, digest/content injection, receipt-conflict rollback, union, partial schemas and required transaction ownership. The first run failed because its fixture omitted FK parent tables; that failure is retained. Full API/Core source type checking passed after correction.

These are source and transaction checks. Exact backup archive/executor recovery, quiescence, full restore, deployed persistence and release acceptance remain open.
