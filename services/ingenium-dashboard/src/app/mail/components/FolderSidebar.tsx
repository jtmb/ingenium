"use client";

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
  folders: folderData,
}: {
  accounts: any[];
  selectedAccount: string;
  selectedFolder: string;
  onSelectFolder: (f: string) => void;
  onSelectAccount?: (accountId: string) => void;
  onCompose: () => void;
  onAddAccount: () => void;
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

  return (
    <div className="min-w-[200px] max-w-[250px] bg-[var(--color-surface-muted)] border-r border-[var(--color-border)] p-2 flex flex-col gap-2">
      {/* Compose button */}
      <button
        onClick={onCompose}
        className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
      >
        Compose
      </button>

      {/* Account selector */}
      <select
        className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm text-[var(--color-text-primary)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
        value={selectedAccount}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "__add__") {
            onAddAccount();
          } else {
            onSelectAccount?.(val);
          }
        }}
      >
        {accounts.length === 0 && (
          <option value="">No accounts</option>
        )}
        {accounts.map((acct: any) => (
          <option key={acct.id} value={acct.id}>
            {acct.connected ? "🟢 " : "⚪ "}{acct.email}{!acct.connected ? " (not connected)" : ""}
          </option>
        ))}
        <option value="__add__" disabled={!onAddAccount}>
          + Add Account
        </option>
      </select>

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
