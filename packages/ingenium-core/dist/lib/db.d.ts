import Database from "better-sqlite3";
export declare function getDb(dbPath: string): Database.Database;
export declare function execTransaction<T>(fn: () => T, retries?: number): T;
/**
 * Sanitize user input for FTS5 literal matching.
 * Escapes double-quotes (FTS5 convention: double them), then wraps the
 * entire query in double-quotes so the FTS5 parser treats it as a literal
 * phrase rather than interpreting operators like *, ^, (, ), -, +, AND, OR,
 * NOT, NEAR.
 */
export declare function sanitizeFts5Query(input: string): string;
export declare function checkpointAfterWrite(): void;
//# sourceMappingURL=db.d.ts.map