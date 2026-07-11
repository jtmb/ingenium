"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * EmptyState — centered placeholder with an optional action button.
 * Used when there's no data to display (no accounts, no emails, etc.).
 */
export default function EmptyState({ message, action, }) {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center py-16 text-center", children: [_jsx("p", { className: "text-gray-500 text-sm mb-4", children: message }), action && (_jsx("button", { onClick: action.onClick, className: "bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium", children: action.label }))] }));
}
