"use client";
import { useState, useRef, useEffect } from "react";

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
}) {
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
              <span className={`w-2 h-2 rounded-full shrink-0 ${selectedAccountData.connected ? "bg-green-500" : "bg-gray-400"}`} />
            </>
          ) : (
            <span className="flex-1 text-left text-[var(--color-text-muted)]">Select account</span>
          )}
          <svg className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg z-50">
            {accounts.length === 0 && (
              <div className="px-3 py-2 text-sm text-[var(--color-text-muted)]">No accounts</div>
            )}
            {accounts.map((acct: any) => (
              <div key={acct.id} className="flex items-center group">
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
                  <span className={`w-2 h-2 rounded-full shrink-0 ${acct.connected ? "bg-green-500" : "bg-gray-400"}`} />
                  {!acct.connected && (
                    <span className="text-xs text-[var(--color-text-muted)]">(not connected)</span>
                  )}
                </button>
                {onDeleteAccount && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteAccount(acct.id); setIsOpen(false); }}
                    className="px-2 py-2 text-sm text-red-500 hover:bg-red-50 hover:text-red-700 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                    title="Remove account"
                  >
                    ✕
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
          return (
            <button
              key={folder.path || folder.name}
              onClick={() => onSelectFolder(folder.path || folder.name)}
              className={`flex items-center justify-between px-3 py-1.5 text-sm rounded text-left transition-colors ${
                isSelected
                  ? "bg-blue-100 text-blue-800 font-medium"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              }`}
            >
              <span className="truncate">{folder.name || folder.path}</span>
              {(folder.totalMessages ?? 0) > 0 && (
                <span className="text-xs text-[var(--color-text-muted)] ml-2">
                  {folder.totalMessages}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
