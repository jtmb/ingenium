// Splice into ACTUAL db.ts after its existing db singleton declaration.
// Private module state; no constructor injection, alternate writer or SQL owner.
type DbBootstrapState = 'closed' | 'opening' | 'ready' | 'closing' | 'failed';
let dbBootstrapState: DbBootstrapState = 'closed';
let dbBootstrapFailure: unknown = null;

function refuseUnverifiedDatabase(): never {
  throw new Error('CORE_DATABASE_BOOTSTRAP_UNAVAILABLE', {cause: dbBootstrapFailure});
}

/** A failed/unknown close retains the exact original and a refusal latch. */
function closeRetainedDatabaseOriginal(): void {
  const original = db;
  if (!original) return refuseUnverifiedDatabase();
  dbBootstrapState = 'closing';
  try {
    original.close();
    if (original.open !== false || db !== original) {
      throw new Error('CORE_DATABASE_CLOSE_UNCONFIRMED');
    }
  } catch (error) {
    dbBootstrapState = 'failed';
    dbBootstrapFailure ??= error;
    throw error;
  }
  // Clear only after the SAME retained original positively confirms closed.
  db = null;
  dbBootstrapState = 'closed';
  dbBootstrapFailure = null;
}
