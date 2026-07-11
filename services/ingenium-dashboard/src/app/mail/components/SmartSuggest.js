"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
/**
 * SmartSuggest — fetches a response suggestion from the /emails/suggest endpoint
 * and displays it. Designed to be simple; extended API client logic is deferred.
 */
export default function SmartSuggest({ emailUid, accountId, apiUrl, }) {
    const [suggestion, setSuggestion] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!emailUid)
            return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        const base = apiUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
        fetch(`${base}/emails/suggest/${emailUid}?project=gh-llm-bootstrap&account=${accountId}`)
            .then((res) => {
            if (!res.ok)
                throw new Error("Failed to fetch suggestion");
            return res.json();
        })
            .then((data) => {
            if (!cancelled) {
                setSuggestion(data.data);
                setLoading(false);
            }
        })
            .catch((err) => {
            if (!cancelled) {
                setError(err.message);
                setLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [emailUid, accountId, apiUrl]);
    if (!emailUid)
        return null;
    if (loading) {
        return (_jsxs("div", { className: "bg-white border border-gray-200 rounded p-4 animate-pulse", children: [_jsx("div", { className: "h-4 bg-gray-100 rounded w-1/3 mb-2" }), _jsx("div", { className: "h-3 bg-gray-100 rounded w-2/3" })] }));
    }
    if (error) {
        return (_jsx("div", { className: "bg-white border border-gray-200 rounded p-4", children: _jsx("p", { className: "text-sm text-gray-500", children: "Suggestion unavailable" }) }));
    }
    if (!suggestion)
        return null;
    return (_jsxs("div", { className: "bg-white border border-gray-200 rounded p-4 space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h4", { className: "text-sm font-semibold text-gray-900", children: "Smart Reply" }), _jsxs("span", { className: "text-xs text-gray-500", children: [(suggestion.confidence * 100).toFixed(0), "% match"] })] }), _jsx("p", { className: "text-sm text-gray-700 line-clamp-3", children: suggestion.body }), suggestion.matchedSkill && (_jsxs("p", { className: "text-xs text-gray-500", children: ["Matched skill: ", suggestion.matchedSkill] }))] }));
}
