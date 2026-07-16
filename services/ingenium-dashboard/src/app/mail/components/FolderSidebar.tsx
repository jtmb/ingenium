"use client";
import { useState, useRef, useEffect } from "react";
import { badgeTones } from '@/lib/badgeTones';

/**
 * FolderSidebar — account selector + folder tree with unread counts.
 * Follows the FileTree pattern from STYLING-GUIDE.md (bg-gray-50, border-r, blue highlight).
 */
export default function FolderSidebar({
  accounts,
  selectedAccount,
  selectedFolder,
  onSelectFolder,
  onSelectAccount,
  onCompose,
  onAddAccount,
  onDeleteAccount,
  folders: folderData,
  syncingFolders,
  folderSyncStatuses,
}: {
  accounts: any[];
  selectedAccount: string;
  selectedFolder: string;
  onSelectFolder: (f: string) => void;
  onSelectAccount?: (accountId: string) => void;
  onCompose: () => void;
  onAddAccount: () => void;
  onDeleteAccount?: (accountId: string) => void;
  folders?: any[];
  syncingFolders?: string[];
  folderSyncStatuses?: any[];
}) {
  /** Default folders displayed when the real folder list hasn't loaded yet.
   *  NOTE: These are common IMAP folder names — actual folders may differ per provider
   *  (e.g., "[Gmail]/Sent" for Gmail). The real list replaces these after the API responds. */
  const defaultFolders = [
    { name: "INBOX", path: "INBOX", unreadMessages: 0 },
    { name: "Sent", path: "Sent", unreadMessages: 0 },
    { name: "Drafts", path: "Drafts", unreadMessages: 0 },
    { name: "Archive", path: "Archive", unreadMessages: 0 },
    { name: "Spam", path: "Spam", unreadMessages: 0 },
    { name: "Trash", path: "Trash", unreadMessages: 0 },
  ];
  const folders = folderData?.length ? folderData : defaultFolders;

  const selectedAccountData = accounts.find(
    (a: any) => a.id === selectedAccount || a.email === selectedAccount
  );

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="min-w-[200px] max-w-[250px] flex-shrink-0 bg-[var(--color-surface-muted)] border-r border-[var(--color-border)] p-2 flex flex-col gap-2">
      {/* Compose button */}
      <button
        onClick={onCompose}
        className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
      >
        Compose
      </button>

      {/* Account selector — custom dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center gap-2 border border-[var(--color-border)] rounded px-2 py-1.5 text-sm text-[var(--color-text-primary)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
        >
          {selectedAccountData ? (
            <>
              <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-medium shrink-0">
                {(selectedAccountData.email || selectedAccountData.id)[0].toUpperCase()}
              </span>
              <span className="flex-1 truncate text-left">{selectedAccountData.email}</span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${selectedAccountData.connected ? badgeTones('green') : badgeTones('gray')}`} />
            </>
          ) : (
            <span className="flex-1 text-left text-[var(--color-text-muted)]">Select account</span>
          )}
          <svg className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg z-50 overflow-hidden">
            {accounts.length === 0 && (
              <div className="px-3 py-2 text-sm text-[var(--color-text-muted)]">No accounts</div>
            )}
            {/** NOTE: Dedup by email — IMAP sync can create duplicate account entries with
                different IDs for the same email address. We show only the first occurrence. */}
            {accounts.filter((acct: any, i: number, arr: any[]) =>
              arr.findIndex((a: any) => a.email === acct.email) === i
            ).map((acct: any) => (
              <div key={acct.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    onSelectAccount?.(acct.id);
                    setIsOpen(false);
                  }}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface-hover)] cursor-pointer ${
                    (selectedAccount === acct.id || selectedAccount === acct.email) ? "bg-[var(--color-surface-selected)]" : ""
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-medium shrink-0">
                    {acct.email[0].toUpperCase()}
                  </span>
                  <span className="flex-1 truncate">{acct.email}</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${acct.connected ? badgeTones('green') : badgeTones('gray')}`} />
                  {!acct.connected && (
                    <span className="text-xs text-[var(--color-text-muted)]">(not connected)</span>
                  )}
                </button>
                {onDeleteAccount && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteAccount(acct.id); }}
                    className="px-2 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer shrink-0"
                    title="Remove account"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {onAddAccount && (
              <>
                <div className="border-t border-[var(--color-border)]" />
                <button
                  type="button"
                  onClick={() => { onAddAccount(); setIsOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-blue-600 hover:bg-[var(--color-surface-hover)] cursor-pointer"
                >
                  + Add Account
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Folder tree */}
      <div className="flex flex-col gap-0.5 mt-1">
        {folders.map((folder: any) => {
          const isSelected = selectedFolder === folder.path || selectedFolder === folder.name;
          const folderKey = folder.path || folder.name;
          const syncStatus = folderSyncStatuses?.find(
            (fs: any) => fs.folder === folderKey
          );
          const isSyncing = syncingFolders?.includes(folderKey) && (syncStatus?.cachedCount ?? 0) === 0;
          const engineState = syncStatus?.engineState;
          const showEngineProgress =
            engineState && engineState.bodiesCached < engineState.bodiesWindow;
          return (
            <button
              key={folderKey}
              onClick={() => onSelectFolder(folderKey)}
              className={`flex items-center justify-between px-3 py-1.5 text-sm rounded text-left transition-colors ${
                isSelected
                  ? "bg-blue-100 text-blue-800 font-medium"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">
                {isSyncing && (
                  <svg className="animate-spin w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                <span className="truncate">{folder.name || folder.path}</span>
              </span>
              <span className="flex items-center gap-2">
                {showEngineProgress && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {engineState.bodiesCached}/{engineState.bodiesWindow}
                  </span>
                )}
                {(folder.totalMessages ?? 0) > 0 && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {folder.totalMessages}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
