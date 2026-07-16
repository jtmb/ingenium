import Database from "better-sqlite3";
/**
 * Returns the singleton SQLite database connection, creating it on first call.
 *
 * Pragma rationale:
 * - `journal_mode = WAL` — permits concurrent readers without blocking writers.
 *   Required for the dashboard and API to read while background synthesis writes.
 * - `busy_timeout = 5000` — SQLite will wait up to 5 s for a lock instead of
 *   immediately returning SQLITE_BUSY. Combined with `execTransaction` retries,
 *   this gives a two-tier contention strategy (SQLite waits, then we retry).
 * - `foreign_keys = ON` — SQLite defaults to OFF for backward compatibility.
 *   Must be re-enabled every connection because it is not persisted in the DB file.
 */
export declare function getDb(dbPath: string): Database.Database;
/**
 * Verify the skills_fts virtual table and all three migration-024 triggers exist,
 * then rebuild the FTS index. If any component is missing, throws an actionable
 * error rather than silently falling back to removed manual FTS writes.
 *
 * This is called after migration 041 is applied (both fresh-DB and upgrade paths).
 */
export declare function verifyAndRebuildSkillsFts(db: Database.Database): void;
/**
 * Execute `fn` inside a SQLite transaction with automatic retry on contention.
 *
 * Retries only on SQLITE_BUSY (another connection holds a lock) and
 * SQLITE_LOCKED (internal SQLite deadlock within the same connection).
 * Other errors (SQLITE_CONSTRAINT, SQLITE_CORRUPT, etc.) are thrown immediately.
 *
 * 🔴 WAL SAFETY: `checkpointAfterWrite()` must NEVER be called inside `fn`.
 * Calling a WAL checkpoint inside an active transaction causes SQLITE_LOCKED
 * because the checkpoint tries to read-lock the WAL while the transaction's
 * write-lock is still held. Always call `checkpointAfterWrite()` *after*
 * `execTransaction()` returns.
 */
export declare function execTransaction<T>(fn: () => T, retries?: number): T;
/**
 * Sanitize user input for FTS5 literal matching.
 *
 * Escapes double-quotes (FTS5 convention: double them), then wraps the
 * entire query in double-quotes so the FTS5 parser treats it as a literal
 * phrase rather than interpreting operators like *, ^, (, ), -, +, AND, OR,
 * NOT, NEAR.
 *
 * NOTE: This is an injection-prevention measure. Without wrapping, a user
 * could inject FTS5 syntax (e.g., `foo OR bar`) that changes query semantics.
 * The double-quote wrapping forces the entire input to be treated as a single
 * literal term that must match verbatim.
 *
 * FIXME: Only `"` is escaped. `'` is safe in FTS5 (it has no special meaning),
 * but if the input contains non-ASCII whitespace or control characters, the
 * FTS5 tokenizer may behave unexpectedly. A future improvement could strip
 * non-printable characters as well.
 */
export declare function sanitizeFts5Query(input: string): string;
export declare function checkpointAfterWrite(): void;
/**
 * Reset the singleton database connection.
 * For test use only — closes the current connection and clears the singleton
 * so the next getDb() call creates a fresh connection to a new path.
 */
export declare function resetDbForTest(): void;
//# sourceMappingURL=db.d.ts.map