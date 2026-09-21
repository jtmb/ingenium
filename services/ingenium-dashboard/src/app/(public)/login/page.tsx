"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthCard, { authInput } from "@/app/components/auth/AuthCard";
import { api, setSessionCsrfToken } from "@/lib/api";
import { safeReturnTo } from "@/lib/safe-return-to";

export default function LoginPage() {
  const params = useSearchParams();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [csrf, setCsrf] = useState(""); const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([api.auth.csrf(), api.auth.oidcProviders()]).then(([c, p]) => { setCsrf(c.data.csrfToken); setProviders(p.data); }); }, []);
  return <AuthCard title="Sign in to Ingenium" description="Use your local account or a configured identity provider.">
    {params.get("reason") === "session-expired" && <p role="alert" className="mb-4 rounded bg-[var(--color-warning-bg)] p-3 text-sm">Your session expired. Sign in to continue.</p>}
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(null);
      try {
        const result = await api.auth.login(email, password, csrf, navigator.userAgent.slice(0, 128));
        setPassword("");
        if (result.data.mfaRequired) window.location.assign(`/mfa?challenge=${encodeURIComponent(result.data.challengeToken!)}&csrf=${encodeURIComponent(csrf)}&returnTo=${encodeURIComponent(safeReturnTo(params.get("returnTo")))}`);
        else { setSessionCsrfToken(result.data.csrfToken ?? null); window.location.assign(safeReturnTo(params.get("returnTo"))); }
      } catch { setPassword(""); setError("The email or password is incorrect."); setBusy(false); }
    }}>
      <div><label htmlFor="login-email" className="mb-1 block text-sm font-medium">Email</label><input id="login-email" className={authInput} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div><label htmlFor="login-password" className="mb-1 block text-sm font-medium">Password</label><input id="login-password" className={authInput} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      {error && <p role="alert" className="text-sm text-[var(--color-error-text)]">{error}</p>}
      <button disabled={busy || !csrf} className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
    </form>
    {providers.length > 0 && <div className="mt-5 space-y-2 border-t border-[var(--color-border)] pt-5">{providers.map((provider) => <button key={provider.id} className="w-full rounded border border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-surface-hover)]" onClick={async () => { const result = await api.auth.oidcStart(provider.id, csrf); window.location.assign(result.data.authorizationUrl); }}>Continue with {provider.name}</button>)}</div>}
    <a className="mt-5 block text-center text-sm text-[var(--color-text-link)] hover:underline" href="/forgot-password">Forgot password?</a>
  </AuthCard>;
}
