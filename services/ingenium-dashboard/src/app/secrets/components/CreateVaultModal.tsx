"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../../lib/api";

interface CreateVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  project: string;
}

/**
 * CreateVaultModal — first-run passphrase creation dialog.
 *
 * Shown when the vault is sealed AND not yet initialized. The user picks a
 * new passphrase, confirms it, checks an acknowledgement, and submits to
 * create + unseal the vault in one step.
 */
export default function CreateVaultModal({
  isOpen,
  onClose,
  onSuccess,
  project,
}: CreateVaultModalProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // --- Focus trap + Escape ---
  useEffect(() => {
    if (!isOpen) return;

    // Store the element that had focus before the modal opened
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first input after a short delay for the transition
    const timer = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Simple focus trap
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      // Restore focus
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setPassphrase("");
      setConfirmation("");
      setShowPassphrase(false);
      setShowConfirmation(false);
      setAcknowledged(false);
      setError(null);
    }
  }, [isOpen]);

  const passwordsMatch = passphrase === confirmation && passphrase.length >= 12;
  const canSubmit = acknowledged && passwordsMatch && !loading;

  const handleInitialize = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.vault.initialize(passphrase, confirmation, project);
      if (r.data.ok && r.data.unsealed) {
        onSuccess();
      } else {
        setError("Failed to create vault. Please try again.");
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to create vault");
    } finally {
      setLoading(false);
    }
  }, [canSubmit, passphrase, confirmation, project, onSuccess]);

  if (!isOpen) return null;

  const bothHaveValue = passphrase.length > 0 && confirmation.length > 0;
  const lengthOk = passphrase.length >= 12;
  const matchOk = passphrase === confirmation;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-vault-title"
        className="bg-[var(--color-surface)] p-6 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4">
          <div className="mb-3 flex justify-center">
            <svg
              className="w-10 h-10 text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" strokeWidth="1.5" />
              <path d="M7 11V7a5 5 0 0110 0v4" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="12" cy="16" r="1" fill="currentColor" />
              <path d="M12 14v4M10 16h4" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h3
            id="create-vault-title"
            className="text-lg font-semibold text-[var(--color-text-primary)] text-center"
          >
            Create Your Vault Passphrase
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] text-center mt-2">
            This passphrase is used to derive your encryption key. It is never
            stored and cannot be recovered. If you lose it, ALL stored secrets
            will be permanently inaccessible.
          </p>
        </div>

        {/* Error display */}
        {error && (
          <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] p-2 rounded text-xs text-[var(--color-error-text)] mb-3">
            {error}
          </div>
        )}

        {/* Warning banner */}
        <div
          id="create-vault-warning"
          className="bg-amber-50 border border-amber-200 p-3 rounded text-sm text-amber-800 mb-4"
        >
          <span className="font-semibold" aria-hidden="true">⚠️</span>{" "}
          <strong>No recovery key exists.</strong> There is no way to reset or
          recover a lost passphrase.
        </div>

        {/* Passphrase field */}
        <div className="mb-3">
          <label
            htmlFor="create-vault-passphrase"
            className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
          >
            Passphrase
          </label>
          <div className="relative">
            <input
              ref={firstInputRef}
              id="create-vault-passphrase"
              type={showPassphrase ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="At least 12 characters"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 pr-10 text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)]"
              aria-invalid={passphrase.length > 0 && !lengthOk}
              aria-describedby="create-vault-passphrase-hint"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassphrase((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1"
              aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
            >
              {showPassphrase ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="3" y1="3" x2="21" y2="21" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="3" strokeWidth="1.5" />
                </svg>
              )}
            </button>
          </div>
          <p
            id="create-vault-passphrase-hint"
            className={`text-xs mt-1 ${lengthOk ? "text-green-600" : "text-[var(--color-text-muted)]"}`}
            aria-live="polite"
          >
            {passphrase.length > 0 && !lengthOk
              ? `At least 12 characters (${passphrase.length}/12)`
              : "At least 12 characters"}
          </p>
        </div>

        {/* Confirmation field */}
        <div className="mb-3">
          <label
            htmlFor="create-vault-confirmation"
            className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
          >
            Confirm Passphrase
          </label>
          <div className="relative">
            <input
              id="create-vault-confirmation"
              type={showConfirmation ? "text" : "password"}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="Re-enter passphrase"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 pr-10 text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)]"
              aria-invalid={confirmation.length > 0 && !matchOk}
              aria-describedby="create-vault-confirmation-hint"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirmation((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-1"
              aria-label={showConfirmation ? "Hide confirmation" : "Show confirmation"}
            >
              {showConfirmation ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="3" y1="3" x2="21" y2="21" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="3" strokeWidth="1.5" />
                </svg>
              )}
            </button>
          </div>
          <div id="create-vault-confirmation-hint" className="flex items-center gap-1 mt-1" aria-live="polite">
            {bothHaveValue && !matchOk && (
              <span className="text-xs text-red-600">Passphrases do not match</span>
            )}
            {bothHaveValue && matchOk && lengthOk && (
              <span className="text-xs text-green-600">
                <svg className="w-3.5 h-3.5 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Passphrases match
              </span>
            )}
          </div>
        </div>

        {/* Acknowledgement checkbox */}
        <div className="mb-4">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
              aria-describedby="create-vault-warning"
            />
            <span className="text-xs text-[var(--color-text-secondary)]">
              I understand there is no passphrase recovery
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleInitialize}
            disabled={!canSubmit}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create & Unseal Vault"}
          </button>
        </div>
      </div>
    </div>
  );
}
