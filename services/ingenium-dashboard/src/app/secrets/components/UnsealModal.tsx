"use client";

import { useState } from "react";
import { api } from "../../../lib/api";

interface UnsealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  project: string;
}

/**
 * UnsealModal — passphrase input dialog to unlock the vault.
 *
 * Shown when vault status is "sealed". The user enters their vault
 * passphrase and clicks "Unseal Vault".
 */
export default function UnsealModal({
  isOpen,
  onClose,
  onSuccess,
  project,
}: UnsealModalProps) {
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUnseal = async () => {
    if (!passphrase.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.vault.unseal(passphrase, project);
      if (r.data.unsealed) {
        onSuccess();
      } else {
        setError("Failed to unseal vault. Check your passphrase.");
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to unseal vault");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[var(--color-surface)] p-6 rounded-lg shadow-xl w-96"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <div className="mb-3 flex justify-center">
            <svg className="w-10 h-10 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="11" width="18" height="11" rx="2" strokeWidth="1.5" />
              <path d="M7 11V7a5 5 0 0110 0v4" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="12" cy="16" r="1" fill="currentColor" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] text-center">
            Unseal Vault
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] text-center mt-1">
            Enter your vault passphrase to unlock all secrets.
          </p>
        </div>

        {error && (
          <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] p-2 rounded text-xs text-[var(--color-error-text)] mb-3">
            {error}
          </div>
        )}

        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Vault passphrase"
          className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] mb-4"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleUnseal();
          }}
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleUnseal}
            disabled={!passphrase.trim() || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Unsealing..." : "Unseal Vault"}
          </button>
        </div>
      </div>
    </div>
  );
}
