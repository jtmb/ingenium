"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
const PROJECT = "gh-llm-bootstrap";
/**
 * OAuth callback handler — exchanges the `?code=` and `?state=` with the backend.
 * Shows loading, success, or error states.
 */
function OAuthCallbackInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const [status, setStatus] = useState("loading");
    const [errorMsg, setErrorMsg] = useState(null);
    useEffect(() => {
        if (!code) {
            setStatus("error");
            setErrorMsg("No authorization code received from provider.");
            return;
        }
        // Determine provider from state (or try each)
        const provider = state || "gmail";
        const exchangeCode = async () => {
            try {
                const res = await fetch(`${API_BASE}/emails/accounts/oauth?project=${PROJECT}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        provider,
                        code,
                        redirectUri: window.location.origin + "/mail/oauth/callback",
                    }),
                });
                if (res.ok) {
                    setStatus("success");
                }
                else {
                    const data = await res.json().catch(() => ({ error: { message: "OAuth exchange failed" } }));
                    setStatus("error");
                    setErrorMsg(data.error?.message || "Failed to complete OAuth with provider.");
                }
            }
            catch (err) {
                setStatus("error");
                setErrorMsg(err.message || "Network error during OAuth exchange.");
            }
        };
        exchangeCode();
    }, [code, state]);
    return (_jsx("div", { className: "max-w-lg mx-auto mt-12", children: _jsxs("div", { className: "bg-white p-6 rounded-lg border text-center space-y-4", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Email Account Setup" }), status === "loading" && (_jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "animate-pulse flex justify-center", children: _jsx("div", { className: "w-8 h-8 bg-gray-100 rounded-full" }) }), _jsx("p", { className: "text-gray-600 text-sm", children: "Exchanging authorization code with provider..." })] })), status === "success" && (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto text-xl", children: "\u2713" }), _jsx("p", { className: "text-gray-900 font-medium", children: "Account connected successfully!" }), _jsx(Link, { href: "/mail", className: "inline-block bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium", children: "Go to Mail" })] })), status === "error" && (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-xl", children: "\u2715" }), _jsx("p", { className: "text-red-600 text-sm", children: errorMsg }), _jsxs("div", { className: "flex gap-2 justify-center", children: [_jsx("button", { onClick: () => router.push("/mail"), className: "bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium", children: "Back to Mail" }), _jsx("button", { onClick: () => router.refresh(), className: "text-gray-600 hover:text-gray-900 py-2 px-4 rounded text-sm font-medium", children: "Retry" })] })] }))] }) }));
}
/**
 * Wrapped in Suspense because useSearchParams() requires it.
 */
export default function OAuthCallbackPage() {
    return (_jsx(Suspense, { fallback: _jsx("div", { className: "max-w-lg mx-auto mt-12", children: _jsxs("div", { className: "bg-white p-6 rounded-lg border text-center space-y-3 animate-pulse", children: [_jsx("div", { className: "w-8 h-8 bg-gray-100 rounded-full mx-auto" }), _jsx("div", { className: "h-4 bg-gray-100 rounded w-2/3 mx-auto" })] }) }), children: _jsx(OAuthCallbackInner, {}) }));
}
