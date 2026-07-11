"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * FolderSidebar — account selector + folder tree with unread counts.
 * Follows the FileTree pattern from STYLING-GUIDE.md (bg-gray-50, border-r, blue highlight).
 */
export default function FolderSidebar({ accounts, selectedAccount, selectedFolder, onSelectFolder, onCompose, onAddAccount, folders: folderData, }) {
    const defaultFolders = [
        { name: "INBOX", path: "INBOX", unreadMessages: 0 },
        { name: "Sent", path: "Sent", unreadMessages: 0 },
        { name: "Drafts", path: "Drafts", unreadMessages: 0 },
        { name: "Archive", path: "Archive", unreadMessages: 0 },
        { name: "Spam", path: "Spam", unreadMessages: 0 },
        { name: "Trash", path: "Trash", unreadMessages: 0 },
    ];
    const folders = folderData?.length ? folderData : defaultFolders;
    const selectedAccountData = accounts.find((a) => a.id === selectedAccount || a.email === selectedAccount);
    return (_jsxs("div", { className: "min-w-[200px] max-w-[250px] bg-gray-50 border-r border-gray-200 p-2 flex flex-col gap-2", children: [_jsx("button", { onClick: onCompose, className: "bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium", children: "Compose" }), _jsxs("select", { className: "w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900 bg-white hover:bg-gray-50 cursor-pointer", value: selectedAccount, onChange: (e) => {
                    const val = e.target.value;
                    if (val === "__add__") {
                        onAddAccount();
                    }
                    else {
                        // Select account — parent handles folder reset
                        onSelectFolder("INBOX");
                    }
                }, children: [accounts.length === 0 && (_jsx("option", { value: "", children: "No accounts" })), accounts.map((acct) => (_jsx("option", { value: acct.id, children: acct.email }, acct.id))), _jsx("option", { value: "__add__", disabled: !onAddAccount, children: "+ Add Account" })] }), _jsx("div", { className: "flex flex-col gap-0.5 mt-1", children: folders.map((folder) => {
                    const isSelected = selectedFolder === folder.path || selectedFolder === folder.name;
                    return (_jsxs("button", { onClick: () => onSelectFolder(folder.path || folder.name), className: `flex items-center justify-between px-3 py-1.5 text-sm rounded text-left transition-colors ${isSelected
                            ? "bg-blue-100 text-blue-800 font-medium"
                            : "text-gray-600 hover:bg-gray-100"}`, children: [_jsx("span", { className: "truncate", children: folder.name || folder.path }), (folder.unreadMessages ?? 0) > 0 && (_jsx("span", { className: "text-xs text-gray-500 ml-2", children: folder.unreadMessages }))] }, folder.path || folder.name));
                }) })] }));
}
