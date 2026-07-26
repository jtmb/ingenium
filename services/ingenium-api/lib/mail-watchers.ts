/**
 * API-owned watcher registry. The mail package owns IMAP connections, while
 * this small registry records which watchers this API process started so they
 * are still stopped when an account is removed before process shutdown.
 */
const activeWatcherAccountIds = new Set<string>();

export function registerMailWatcher(accountId: string): void {
  activeWatcherAccountIds.add(accountId);
}

export function unregisterMailWatcher(accountId: string): void {
  activeWatcherAccountIds.delete(accountId);
}

export function getRegisteredMailWatcherIds(): string[] {
  return [...activeWatcherAccountIds];
}
