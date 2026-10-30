/** Close the singleton before RESTORE-101 scans for database holders. */
export function closeDbForMaintenance(): void {
  if (dbBootstrapState === 'opening' || dbBootstrapState === 'closing') {
    return refuseUnverifiedDatabase();
  }
  if (db) closeRetainedDatabaseOriginal();
  else if (dbBootstrapState !== 'closed') return refuseUnverifiedDatabase();
  writeCount = 0;
}
