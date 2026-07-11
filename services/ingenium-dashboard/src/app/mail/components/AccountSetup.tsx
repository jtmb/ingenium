"use client";

import { useState, useEffect } from "react";

/**
 * AccountSetup — two modes: provider selection grid and manual (app password) form.
 * OAuth buttons redirect to the backend for provider-based auth.
 */
export default function AccountSetup({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"select" | "manual">("select");

  const [email, setEmail] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
  const PROJECT = "gh-llm-bootstrap";

  // Check if OAuth credentials are configured in settings
  const [credsConfigured, setCredsConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`${apiBase}/settings?project=${PROJECT}&key=oauth_gmail_client_id`)
      .then(r => r.json())
      .then(d => {
        const hasGmail = !!d.data?.value;
        // Also check for Outlook
        return fetch(`${apiBase}/settings?project=${PROJECT}&key=oauth_outlook_client_id`)
          .then(r => r.json())
          .then(d2 => setCredsConfigured(hasGmail || !!d2.data?.value));
      })
      .catch(() => setCredsConfigured(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDemoAccount = async () => {
    try {
      const res = await fetch(`${apiBase}/emails/accounts?project=${PROJECT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "demo@example.com",
          name: "Demo Account",
          provider: "custom",
          authType: "app_password",
        }),
      });
      if (res.ok) {
        onComplete();
      } else {
        const data = await res.json();
        alert(data.error?.message || "Failed to create demo account");
      }
    } catch (err: any) {
      alert("Failed to create demo account: " + (err.message || "Unknown error"));
    }
  };

  const handleOAuthRedirect = async (provider: string) => {
    setError(null);
    try {
      const res = await fetch(`${apiBase}/emails/accounts/oauth/url?project=${encodeURIComponent(PROJECT)}&provider=${provider}`);
      const json = await res.json();
      if (!res.ok || !json.data?.url) {
        setError(json.error?.message || "Failed to get OAuth URL — check credentials in Settings");
        return;
      }
      localStorage.setItem("oauth_provider", provider);
      window.location.href = json.data.url;
    } catch (err: any) {
      setError(`OAuth failed: ${err.message}`);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Create the account first, then test with the returned ID
      const createRes = await fetch(`${apiBase}/emails/accounts?project=${PROJECT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: email.split("@")[0],
          provider: "custom",
          authType: "app_password",
          imapHost: imapHost || undefined,
          imapPort: imapPort ? parseInt(imapPort, 10) : undefined,
          smtpHost: smtpHost || undefined,
          smtpPort: smtpPort ? parseInt(smtpPort, 10) : undefined,
          appPassword: password,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        setTestResult(createData.error?.message || "Failed to create account");
        setTesting(false);
        return;
      }

      const accountId = createData.data?.id;
      if (!accountId) {
        setTestResult("Account created but no ID returned");
        setTesting(false);
        return;
      }

      // Test the connection using the account ID
      const testRes = await fetch(`${apiBase}/emails/accounts/${accountId}/test?project=${PROJECT}`, {
        method: "POST",
      });
      const testData = await testRes.json();
      if (testRes.ok && testData.data?.success) {
        setTestResult("Connection successful");
      } else {
        setTestResult(testData.data?.error || testData.error?.message || "Connection failed");
        // Remove the account since connection failed
        await fetch(`${apiBase}/emails/accounts/${accountId}?project=${PROJECT}`, {
          method: "DELETE",
        });
      }
    } catch (err: any) {
      setTestResult(err.message || "Connection error");
    } finally {
      setTesting(false);
    }
  };

  const handleAddAccount = async () => {
    try {
      const res = await fetch(`${apiBase}/emails/accounts?project=${PROJECT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name: email.split("@")[0],
          provider: "custom",
          authType: "app_password",
          imapHost: imapHost || undefined,
          imapPort: imapPort ? parseInt(imapPort, 10) : undefined,
          smtpHost: smtpHost || undefined,
          smtpPort: smtpPort ? parseInt(smtpPort, 10) : undefined,
          appPassword: password,
        }),
      });
      if (res.ok) {
        onComplete();
      } else {
        const data = await res.json();
        alert(data.error?.message || "Failed to add account");
      }
    } catch (err: any) {
      alert(err.message || "Failed to add account");
    }
  };

  // Provider selection grid
  if (mode === "select") {
    return (
      <div className="bg-white p-6 rounded-lg border space-y-6 max-w-xl mx-auto">
        <h2 className="text-lg font-semibold text-gray-900">Add Email Account</h2>

        {/* OAuth not configured warning */}
        {credsConfigured === false && (
          <div className="bg-amber-50 border border-amber-200 rounded p-4 text-center">
            <p className="text-amber-800 font-medium">OAuth not configured</p>
            <p className="text-amber-600 text-sm mt-1">
              Enter your Google or Microsoft OAuth credentials in Settings before adding an account.
            </p>
            <a href="/settings" className="inline-block mt-3 text-sm text-blue-600 hover:underline">
              Go to Settings →
            </a>
          </div>
        )}

        {/* OAuth fetch error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-center">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Gmail */}
          <button
            onClick={() => handleOAuthRedirect("gmail")}
            className="bg-white p-4 rounded border hover:shadow-md transition-shadow text-left"
          >
            <h3 className="text-lg font-semibold text-gray-900">Gmail</h3>
            <p className="text-sm text-gray-600 mt-1">Connect with Google</p>
          </button>

          {/* Outlook */}
          <button
            onClick={() => handleOAuthRedirect("outlook")}
            className="bg-white p-4 rounded border hover:shadow-md transition-shadow text-left"
          >
            <h3 className="text-lg font-semibold text-gray-900">Outlook</h3>
            <p className="text-sm text-gray-600 mt-1">Connect with Microsoft</p>
          </button>

          {/* Custom / Manual */}
          <button
            onClick={() => setMode("manual")}
            className="bg-white p-4 rounded border hover:shadow-md transition-shadow text-left"
          >
            <h3 className="text-lg font-semibold text-gray-900">Custom</h3>
            <p className="text-sm text-gray-600 mt-1">Set up manually</p>
          </button>
        </div>
        <div className="flex justify-between items-center">
          <button
            onClick={loadDemoAccount}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
            title="Create a demo account for UI testing"
          >
            Load demo account for UI testing
          </button>
          <button
            onClick={onCancel}
            className="text-gray-600 hover:text-gray-900 py-2 px-4 rounded text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Manual / app password form
  return (
    <div className="bg-white p-6 rounded-lg border space-y-4 max-w-xl mx-auto">
      <h2 className="text-lg font-semibold text-gray-900">Manual Setup</h2>

      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">Email</label>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">IMAP Host</label>
          <input
            type="text"
            placeholder="imap.example.com"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">IMAP Port</label>
          <input
            type="number"
            placeholder="993"
            value={imapPort}
            onChange={(e) => setImapPort(e.target.value)}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">SMTP Host</label>
          <input
            type="text"
            placeholder="smtp.example.com"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">SMTP Port</label>
          <input
            type="number"
            placeholder="465"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">App Password</label>
        <input
          type="password"
          placeholder="App password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
        />
      </div>

      {testResult && (
        <div className="text-sm px-3 py-2 rounded border border-gray-200 bg-gray-50 text-gray-600">
          {testResult}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleTestConnection}
          disabled={testing || !email}
          className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={handleAddAccount}
          disabled={!email || !password}
          className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add Account
        </button>
        <button
          onClick={() => setMode("select")}
          className="text-gray-600 hover:text-gray-900 py-2 px-4 rounded text-sm font-medium ml-auto"
        >
          Back
        </button>
      </div>
    </div>
  );
}
