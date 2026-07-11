"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * EmailList — search bar + scrollable email rows with pagination.
 * Shows sender, subject, snippet, and date. Distinguishes read/unread.
 */
export default function EmailList({ emails, selectedUid, onSelect, onPageChange, total, page, loading, onSearch, }) {
    const pageSize = 50;
    const totalPages = Math.ceil(total / pageSize);
    const formatDate = (dateStr) => {
        const d = new Date(dateStr);
        const now = new Date();
        const isToday = d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate();
        if (isToday) {
            return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        return d.toLocaleDateString([], { month: "short", day: "numeric" });
    };
    return (_jsxs("div", { className: "flex-1 flex flex-col min-w-0 border-r border-gray-200", children: [_jsx("div", { className: "px-4 py-2 border-b border-gray-200 flex items-center gap-2", children: _jsx("input", { type: "text", placeholder: "Search emails...", className: "flex-1 border border-gray-200 rounded px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200", onChange: (e) => onSearch(e.target.value) }) }), loading && (_jsx("div", { className: "flex-1 divide-y divide-gray-200", children: [1, 2, 3, 4, 5].map((i) => (_jsxs("div", { className: "px-4 py-3 flex gap-3 animate-pulse", children: [_jsx("div", { className: "w-40 h-4 bg-gray-100 rounded" }), _jsx("div", { className: "flex-1 h-4 bg-gray-100 rounded" }), _jsx("div", { className: "w-20 h-4 bg-gray-100 rounded" })] }, i))) })), !loading && (_jsx("div", { className: "flex-1 divide-y divide-gray-200 overflow-y-auto", children: emails.map((email) => {
                    const isUnread = !email.flags?.includes("\\Seen");
                    const isSelected = selectedUid === email.uid;
                    return (_jsx("div", { onClick: () => onSelect(email.uid), className: `px-4 py-3 border-b border-gray-200 hover:bg-gray-50 cursor-pointer flex items-start gap-2 ${isSelected ? "bg-blue-50" : ""}`, children: _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-baseline gap-2", children: [_jsx("span", { className: `w-40 truncate text-sm ${isUnread ? "font-semibold text-gray-900" : "text-gray-600"}`, children: email.from?.[0]?.name || email.from?.[0]?.address || "Unknown" }), _jsx("span", { className: `flex-1 truncate text-sm ${isUnread ? "font-medium text-gray-900" : "text-gray-600"}`, children: email.subject || "(No subject)" }), _jsx("span", { className: "w-20 text-xs text-gray-500 text-right shrink-0", children: formatDate(email.date) })] }), _jsx("p", { className: "text-sm text-gray-500 truncate mt-0.5", children: email.body?.text?.substring(0, 120) || "" })] }) }, email.uid));
                }) })), totalPages > 1 && (_jsxs("div", { className: "flex items-center justify-between px-4 py-2 border-t border-gray-200 text-sm text-gray-600", children: [_jsxs("span", { children: [total, " message", total !== 1 ? "s" : ""] }), _jsxs("div", { className: "flex gap-1", children: [_jsx("button", { onClick: () => onPageChange(page - 1), disabled: page <= 1, className: "px-2 py-1 border border-gray-200 rounded text-xs hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed", children: "Prev" }), _jsxs("span", { className: "px-2 py-1 text-xs", children: [page, " / ", totalPages] }), _jsx("button", { onClick: () => onPageChange(page + 1), disabled: page >= totalPages, className: "px-2 py-1 border border-gray-200 rounded text-xs hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed", children: "Next" })] })] }))] }));
}
