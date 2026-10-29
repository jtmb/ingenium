"use client";

import { useEffect, useState } from "react";
import AuthCard, { authInput } from "@/app/components/auth/AuthCard";
import { api } from "@/lib/api";

export default function BootstrapPage() {
  const [status, setStatus] = useState<"pending" | "claimed" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setStatus(null);
    setLoadError(null);
    void api.bootstrap.status().then((response) => {
      if (active) setStatus(response.data.state);
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : "Owner setup is unavailable. Check the service and retry.");
    });
    return () => { active = false; };
  }, [attempt]);
  return <AuthCard title="Set up Veyra" description="Create the installation owner. This is available only before the installation is claimed.">
    {loadError ? <div role="alert" className="space-y-3"><p>{loadError}</p><button type="button" className="rounded border px-3 py-2" onClick={() => setAttempt(value => value + 1)}>Retry owner setup</button></div>
      : status === "claimed" ? <p role="status">This installation is already configured. <a href="/login" className="text-[var(--color-text-link)]">Sign in</a>.</p>
      : status === null ? <p aria-busy="true">Checking installation…</p>
      : <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
          await api.bootstrap.claim(email, displayName, password);
          setPassword("");
          window.location.assign("/login");
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : "Could not create the owner. Check the service and retry.");
        } finally { setSubmitting(false); }
      }}>
        <div><label htmlFor="owner-name" className="block text-sm font-medium">Display name</label><input id="owner-name" className={authInput} autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} required /></div>
        <div><label htmlFor="owner-email" className="block text-sm font-medium">Email</label><input id="owner-email" className={authInput} type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
        <div><label htmlFor="owner-password" className="block text-sm font-medium">Password</label><input id="owner-password" className={authInput} type="password" minLength={12} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required /></div>
        {submitError && <p role="alert">{submitError}</p>}
        <button disabled={submitting} className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{submitting ? "Creating owner…" : "Create owner"}</button>
      </form>}
  </AuthCard>;
}