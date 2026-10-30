export function getDb(dbPath?: string): Database.Database {
  if (dbBootstrapState === 'ready' && db) return db;
  if (dbBootstrapState !== 'closed' || db) return refuseUnverifiedDatabase();

  const resolvedDbPath = resolveCoreDbPath(dbPath);
  const dir = dirname(resolvedDbPath);
  mkdirSync(dir, { recursive: true });

  // Covers synchronous reentry even from constructor/configuration hooks.
  dbBootstrapState = 'opening';
  try {
    const original = new Database(resolvedDbPath);
    db = original;
    original.function("sha256", { deterministic: true }, (value: string) => createHash("sha256").update(value).digest("hex"));
    original.pragma("journal_mode = WAL");
    original.pragma("busy_timeout = 5000");
    original.pragma("foreign_keys = ON");

    // The fixed root restore executor must inspect the live database before it
    // stops appuser processes. Running schema migrations at that point can
    // rebuild a table while those processes still hold the database open. The
    // executor swaps a previously validated snapshot; its explicit restore-only
    // upgrader handles its narrow allowlist, while ordinary startup migration
    // remains disabled.
    const isRootRestoreMaintenance = process.env.INGENIUM_RESTORE_MAINTENANCE_MODE === "execute"
      && typeof process.getuid === "function" && process.getuid() === 0;
    if (!isRootRestoreMaintenance) runMigrations(original);
    if (db !== original || original.open !== true) {
      throw new Error('CORE_DATABASE_BOOTSTRAP_ORIGINAL_CHANGED');
    }
    dbBootstrapState = 'ready';
    return original;
  } catch (error) {
    dbBootstrapFailure = error;
    dbBootstrapState = 'failed';
    if (db) {
      try { closeRetainedDatabaseOriginal(); }
      catch (closeError) {
        throw new AggregateError([error, closeError], 'CORE_DATABASE_BOOTSTRAP_CLOSE_UNCONFIRMED');
      }
    } else {
      // Constructor never returned an original. No cached handle can escape.
      dbBootstrapState = 'closed';
      dbBootstrapFailure = null;
    }
    throw error;
  }
}
