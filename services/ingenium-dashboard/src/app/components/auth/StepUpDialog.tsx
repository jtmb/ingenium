"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { authInput } from "./AuthCard";

export default function StepUpDialog({ open, onClose, onComplete }: { open: boolean; onClose: () => void; onComplete: () => void }) {
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>("button, input, [href], [tabindex]:not([tabindex='-1'])"));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previousFocus.current?.focus(); setCredential(""); };
  }, [onClose, open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="step-up-title" className="w-full max-w-md rounded-xl bg-[var(--color-surface)] p-6">
      <h2 id="step-up-title" className="text-lg font-semibold">Confirm it’s you</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Enter your password, authenticator code, or recovery code.</p>
      <form className="mt-4 space-y-4" onSubmit={async (event) => {
        event.preventDefault(); setError(null);
        try { await api.auth.stepUp(credential); setCredential(""); onComplete(); } catch { setCredential(""); setError("Authentication could not be confirmed."); }
      }}>
        <label className="block text-sm font-medium" htmlFor="step-up-credential">Credential</label>
        <input id="step-up-credential" className={authInput} type="password" autoComplete="current-password" value={credential} onChange={(event) => setCredential(event.target.value)} required />
        {error && <p role="alert" className="text-sm text-[var(--color-error-text)]">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2">Cancel</button><button className="rounded bg-blue-600 px-4 py-2 text-white">Continue</button></div>
      </form>
    </div>
  </div>;
}
