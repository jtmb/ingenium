"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useCallback } from "react";
export default function Overlay({ isOpen, onClose, title, subtitle, fullScreen, children }) {
    const handleKeyDown = useCallback((e) => {
        if (e.key === "Escape")
            onClose();
    }, [onClose]);
    useEffect(() => {
        if (isOpen) {
            document.addEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "hidden";
        }
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "";
        };
    }, [isOpen, handleKeyDown]);
    if (!isOpen)
        return null;
    return (_jsxs("div", { className: "fixed inset-0 z-50 flex items-start justify-center", children: [_jsx("div", { className: "absolute inset-0 bg-black/50", onClick: onClose }), _jsxs("div", { className: `relative bg-white rounded-lg shadow-2xl flex flex-col ${fullScreen
                    ? "w-[calc(100%-32px)] h-[calc(100%-32px)] m-4 max-w-none"
                    : "mt-8 mb-8 w-11/12 max-w-5xl max-h-[90vh]"}`, children: [_jsxs("div", { className: "flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { className: "text-xl font-bold truncate", children: title }), subtitle && _jsx("p", { className: "text-sm text-gray-500 truncate", children: subtitle })] }), _jsx("button", { onClick: onClose, className: "ml-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full shrink-0", "aria-label": "Close", children: _jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) }) })] }), _jsx("div", { className: "flex-1 overflow-y-auto px-6 py-4", children: children })] })] }));
}
