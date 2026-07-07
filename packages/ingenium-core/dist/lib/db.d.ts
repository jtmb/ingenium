import Database from "better-sqlite3";
export declare function getDb(dbPath: string): Database.Database;
export declare function execTransaction<T>(fn: () => T, retries?: number): T;
export declare function checkpointAfterWrite(): void;
//# sourceMappingURL=db.d.ts.map