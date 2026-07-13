"use client";

import { useState, useEffect } from "react";
import { useProject } from "../../../lib/ProjectContext";

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
  const project = useProject();

  // Check if OAuth credentials are configured in settings
  const [credsConfigured, setCredsConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`${apiBase}/settings?project=${project}&key=oauth_gmail_client_id`)
      .then(r => r.json())
      .then(d => {
        const hasGmail = !!d.data?.value;
        // Also check for Outlook
        return fetch(`${apiBase}/settings?project=${project}&key=oauth_outlook_client_id`)
          .then(r => r.json())
          .then(d2 => setCredsConfigured(hasGmail || !!d2.data?.value));
      })
      .catch(() => setCredsConfigured(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOAuthRedirect = async (provider: string) => {
    setError(null);
    try {
      const res = await fetch(`${apiBase}/emails/accounts/oauth/url?project=${encodeURIComponent(project)}&provider=${provider}`);
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
      const createRes = await fetch(`${apiBase}/emails/accounts?project=${project}`, {
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
      const testRes = await fetch(`${apiBase}/emails/accounts/${accountId}/test?project=${project}`, {
        method: "POST",
      });
      const testData = await testRes.json();
      if (testRes.ok && testData.data?.success) {
        setTestResult("Connection successful");
      } else {
        setTestResult(testData.data?.error || testData.error?.message || "Connection failed");
        // Remove the account since connection failed
        await fetch(`${apiBase}/emails/accounts/${accountId}?project=${project}`, {
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
      const res = await fetch(`${apiBase}/emails/accounts?project=${project}`, {
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
      <div className="bg-[var(--color-surface)] p-6 rounded-lg border border-[var(--color-border)] space-y-6 max-w-xl mx-auto">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Add Email Account</h2>

        {/* OAuth not configured warning */}
        {credsConfigured === false && (
          <div className="bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] rounded p-4 text-center">
            <p className="text-[var(--color-warning-text)] font-medium">OAuth not configured</p>
            <p className="text-[var(--color-warning-text)] text-sm mt-1">
              Enter your Google or Microsoft OAuth credentials in Settings before adding an account.
            </p>
            <a href="/settings" className="inline-block mt-3 text-sm text-[var(--color-text-link)] hover:underline">
              Go to Settings →
            </a>
          </div>
        )}

        {/* OAuth fetch error */}
        {error && (
          <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-3 text-center">
            <p className="text-[var(--color-error-text)] text-sm">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Gmail */}
          <button
            onClick={() => handleOAuthRedirect("gmail")}
            className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] hover:shadow-md transition-shadow text-left"
          >
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">Gmail</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">Connect with Google</p>
          </button>

          {/* Outlook */}
          <button
            onClick={() => handleOAuthRedirect("outlook")}
            className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] hover:shadow-md transition-shadow text-left"
          >
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">Outlook</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">Connect with Microsoft</p>
          </button>

          {/* Custom / Manual */}
          <button
            onClick={() => setMode("manual")}
            className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] hover:shadow-md transition-shadow text-left"
          >
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">Custom</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">Set up manually</p>
          </button>
        </div>
        <div className="flex justify-end items-center">
          <button
            onClick={onCancel}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-2 px-4 rounded text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Manual / app password form
  return (
    <div className="bg-[var(--color-surface)] p-6 rounded-lg border border-[var(--color-border)] space-y-4 max-w-xl mx-auto">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Manual Setup</h2>

      <div>
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Email</label>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">IMAP Host</label>
          <input
            type="text"
            placeholder="imap.example.com"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">IMAP Port</label>
          <input
            type="number"
            placeholder="993"
            value={imapPort}
            onChange={(e) => setImapPort(e.target.value)}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">SMTP Host</label>
          <input
            type="text"
            placeholder="smtp.example.com"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">SMTP Port</label>
          <input
            type="number"
            placeholder="465"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">App Password</label>
        <input
          type="password"
          placeholder="App password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      {testResult && (
        <div className="text-sm px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]">
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
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-2 px-4 rounded text-sm font-medium ml-auto"
        >
          Back
        </button>
      </div>
    </div>
  );
}
