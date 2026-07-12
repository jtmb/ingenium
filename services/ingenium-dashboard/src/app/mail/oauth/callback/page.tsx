"use client";

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
  const error = searchParams.get("error");
  const errorDesc = searchParams.get("error_description");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // Surface provider-disclosed errors (e.g. Google's access_denied) directly to the user
    if (error) {
      setStatus("error");
      setErrorMsg(`${error}${errorDesc ? ": " + errorDesc : ""}`);
      return;
    }

    if (!code) {
      setStatus("error");
      setErrorMsg("No authorization code received from provider.");
      return;
    }

    // Determine provider from localStorage (set before OAuth redirect)
    const provider = localStorage.getItem("oauth_provider") || "gmail";

    const exchangeCode = async () => {
      try {
        const res = await fetch(`${API_BASE}/emails/accounts/oauth?project=${PROJECT}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            code,
            state,
            redirectUri: window.location.origin + "/mail/oauth/callback",
          }),
        });

        if (res.ok) {
          setStatus("success");
        } else {
          const data = await res.json().catch(() => ({ error: { message: "OAuth exchange failed" } }));
          setStatus("error");
          setErrorMsg(data.error?.message || "Failed to complete OAuth with provider.");
        }
      } catch (err: any) {
        setStatus("error");
        setErrorMsg(err.message || "Network error during OAuth exchange.");
      }
    };

    exchangeCode();
  }, [code, state]);

  return (
    <div className="max-w-lg mx-auto mt-12">
      <div className="bg-white p-6 rounded-lg border text-center space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Email Account Setup</h1>

        {status === "loading" && (
          <div className="space-y-3">
            <div className="animate-pulse flex justify-center">
              <div className="w-8 h-8 bg-gray-100 rounded-full" />
            </div>
            <p className="text-gray-600 text-sm">
              Exchanging authorization code with provider...
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="space-y-4">
            <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto text-xl">
              ✓
            </div>
            <p className="text-gray-900 font-medium">
              Account connected successfully!
            </p>
            <Link
              href="/mail"
              className="inline-block bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
            >
              Go to Mail
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-xl">
              ✕
            </div>
            <p className="text-red-600 text-sm">{errorMsg}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => router.push("/mail")}
                className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
              >
                Back to Mail
              </button>
              <button
                onClick={() => router.refresh()}
                className="text-gray-600 hover:text-gray-900 py-2 px-4 rounded text-sm font-medium"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Wrapped in Suspense because useSearchParams() requires it.
 */
export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-lg mx-auto mt-12">
          <div className="bg-white p-6 rounded-lg border text-center space-y-3 animate-pulse">
            <div className="w-8 h-8 bg-gray-100 rounded-full mx-auto" />
            <div className="h-4 bg-gray-100 rounded w-2/3 mx-auto" />
          </div>
        </div>
      }
    >
      <OAuthCallbackInner />
    </Suspense>
  );
}
