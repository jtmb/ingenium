"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  EMPTY_VAULT_RESET_CONFIRMATION,
  EMPTY_VAULT_RESET_REASONS,
} from "../../../lib/api";
import { useVaultAttemptCooldown } from "./useVaultAttemptCooldown";
import StepUpDialog from "../../components/auth/StepUpDialog";

interface UnsealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onReset: () => void;
  project: string;
}

function emptyResetGuidance(reason: string | null): string {
  if (reason === EMPTY_VAULT_RESET_REASONS.protectedDependencies) {
    return "Reset is blocked to prevent loss of protected provider or configuration data. Enter the existing Vault passphrase, or explicitly remove or reconfigure those dependencies first.";
  }
  if (reason === EMPTY_VAULT_RESET_REASONS.unsealed) {
    return "The Vault is currently unsealed. Use the existing Vault passphrase to continue, or lock the Vault and check reset eligibility again.";
  }
  if (reason === EMPTY_VAULT_RESET_REASONS.notInitialized) {
    return "The Vault is not initialized. Refresh the page to continue with Vault setup; there is nothing to reset.";
  }
  return "Empty-vault reset is unavailable. Enter the existing Vault passphrase or retry the eligibility check.";
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
  onReset,
  project,
}: UnsealModalProps) {
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const [resetStepUp, setResetStepUp] = useState(false);
  const [resetEligible, setResetEligible] = useState(false);
  const [resetReason, setResetReason] = useState<string | null>(null);
  const [resetEligibilityError, setResetEligibilityError] = useState<"authorization" | "unavailable" | null>(null);
  const [resetEligibilityLoading, setResetEligibilityLoading] = useState(false);
  const [resetEligibilityRefresh, setResetEligibilityRefresh] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { remainingSeconds, isCoolingDown, startCooldownFor } = useVaultAttemptCooldown();
  const unsealAttemptRef = useRef(false);

  useEffect(() => {
    let active = true;
    if (!isOpen) return;

    queueMicrotask(() => {
      if (!active) return;
      setResetEligible(false);
      setResetReason(null);
      setResetEligibilityError(null);
      setResetEligibilityLoading(true);
    });

    void api.vault.emptyReset.eligibility(project).then((metadata) => {
      if (!active) return;
      setResetEligible(metadata.data.eligible);
      if (metadata.data.eligible) {
        setResetReason(null);
      } else {
        setResetReason(emptyResetGuidance(metadata.data.reason));
      }
    }).catch((error: unknown) => {
      if (!active) return;
      setResetEligibilityError(error instanceof ApiError && (error.status === 401 || error.status === 403)
        ? "authorization"
        : "unavailable");
    }).finally(() => {
      if (active) setResetEligibilityLoading(false);
    });

    return () => { active = false; };
  }, [isOpen, project, resetEligibilityRefresh]);

  if (!isOpen) return null;

  const handleUnseal = async () => {
    if (!passphrase.trim() || loading || isCoolingDown || unsealAttemptRef.current) return;
    unsealAttemptRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const r = await api.vault.unseal(passphrase, project);
      if (r.data.unsealed) {
        onSuccess();
      } else {
        setError("Failed to unseal vault. Check your passphrase.");
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "STEP_UP_REQUIRED") {
        setStepUp(true);
      } else if (startCooldownFor(error)) {
        setError("Too many unlock attempts. Wait for the countdown before trying again.");
      } else {
        setError("Unable to unseal the vault. Check the passphrase and try again.");
        if (error instanceof ApiError && error.status === 403 && error.code === "VAULT_SEALED") {
          try {
            const metadata = await api.vault.emptyReset.eligibility(project);
            setResetEligible(metadata.data.eligible);
            setResetReason(metadata.data.eligible ? null : emptyResetGuidance(metadata.data.reason));
            setResetEligibilityError(null);
          } catch (metadataError: unknown) {
            setResetEligible(false);
            setResetReason(null);
            setResetEligibilityError(metadataError instanceof ApiError && (metadataError.status === 401 || metadataError.status === 403)
              ? "authorization"
              : "unavailable");
          }
        }
      }
    } finally {
      unsealAttemptRef.current = false;
      setLoading(false);
    }
  };

  const handleEmptyReset = async () => {
    if (resetting) return;
    setResetting(true);
    setError(null);
    try {
      const response = await api.vault.emptyReset.reset(EMPTY_VAULT_RESET_CONFIRMATION, project);
      if (response.data.reset) onReset();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "VAULT_RESET_BLOCKED") {
        setError("Protected provider or vault dependencies still exist. Enter the current passphrase, or remove/reconfigure those dependencies before trying again.");
      } else if (error instanceof ApiError && error.code === "VAULT_RESET_CONFLICT") {
        setError("Vault data changed during the reset check. No changes were made; check eligibility and try again.");
      } else {
        setError("The empty vault could not be reset safely. No changes were made.");
      }
    } finally {
      setResetting(false);
    }
  };

  return <>
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
          <div role="alert" className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] p-2 rounded text-xs text-[var(--color-error-text)] mb-3">
            {error}
            {remainingSeconds !== null && <span> Try again in {remainingSeconds}s.</span>}
          </div>
        )}

        {resetEligibilityLoading && (
          <div role="status" className="bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-2 rounded text-xs text-[var(--color-text-secondary)] mb-3">
            Checking empty-vault reset eligibility...
          </div>
        )}

        {!resetEligibilityLoading && resetReason && (
          <div role="note" className="bg-amber-50 border border-amber-200 p-2 rounded text-xs text-amber-800 mb-3">
            {resetReason}
          </div>
        )}

        {!resetEligibilityLoading && resetEligibilityError && (
          <div role="alert" className="bg-amber-50 border border-amber-200 p-2 rounded text-xs text-amber-800 mb-3">
            <p>
              {resetEligibilityError === "authorization"
                ? "Reset eligibility requires an authorized installation administrator session. Sign in with an authorized account, then retry."
                : "Reset eligibility could not be verified. No reset is available until verification succeeds."}
            </p>
            <button
              type="button"
              className="mt-2 rounded border border-amber-700 px-2 py-1 font-medium hover:bg-amber-100"
              onClick={() => {
                setResetEligible(false);
                setResetReason(null);
                setResetEligibilityError(null);
                setResetEligibilityLoading(true);
                setResetEligibilityRefresh((value) => value + 1);
              }}
            >
              Retry eligibility check
            </button>
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
          {!resetEligibilityLoading && resetEligible && (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={resetting}
              className="mr-auto px-4 py-2 border border-red-600 rounded text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Forgot passphrase / Reset empty vault
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleUnseal}
            disabled={!passphrase.trim() || loading || isCoolingDown}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Unsealing..." : isCoolingDown ? `Try again in ${remainingSeconds}s` : "Unseal Vault"}
          </button>
        </div>
      </div>
    </div>
    {confirmReset && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setConfirmReset(false)}>
        <div role="dialog" aria-modal="true" aria-labelledby="reset-empty-vault-title" className="w-full max-w-md rounded-lg bg-[var(--color-surface)] p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
          <h3 id="reset-empty-vault-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Reset empty vault?</h3>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            This permanently removes the current vault initialization. It is allowed only when the service contains no encrypted vault items or credential references. You will create a new, unrelated passphrase afterward.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
            <button type="button" className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700" onClick={() => { setConfirmReset(false); setResetStepUp(true); }}>Confirm empty-vault reset</button>
          </div>
        </div>
      </div>
    )}
    <StepUpDialog
      open={stepUp}
      onClose={() => setStepUp(false)}
      onComplete={() => {
        setStepUp(false);
        void handleUnseal();
      }}
    />
    <StepUpDialog
      open={resetStepUp}
      onClose={() => setResetStepUp(false)}
      onComplete={() => {
        setResetStepUp(false);
        void handleEmptyReset();
      }}
    />
  </>;
}
