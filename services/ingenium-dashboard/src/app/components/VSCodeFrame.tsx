"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRuntimeLaunch } from "@/lib/use-runtime-launch";
import { useRuntime } from "@/lib/RuntimeContext";
import RuntimeWorkspacePicker from "./RuntimeWorkspacePicker";

export const VSCODE_STATUS_MAX_ATTEMPTS = 3;
export const VSCODE_STATUS_POLL_MS = 2_000;
export const VSCODE_STATUS_TIMEOUT_MS = 4_000;
export const VSCODE_FRAME_TIMEOUT_MS = 15_000;

function TrustNotice() {
  return (
    <p className="mt-3 text-xs text-[var(--color-text-muted)]">
      This audience is available only through your authenticated isolated runtime.
    </p>
  );
}

interface FrameNoticeProps {
  title: string;
  detail: string;
  role: "status" | "alert";
  onRetry?: () => void;
  directUrl?: string | null;
  noticeRef: RefObject<HTMLDivElement | null>;
}

function FrameNotice({ title, detail, role, onRetry, directUrl, noticeRef }: FrameNoticeProps) {
  return (
    <div className="absolute inset-0 flex min-w-0 items-center justify-center overflow-auto bg-[var(--color-surface-muted)] p-4 sm:p-6">
      <div
        ref={noticeRef}
        role={role}
        aria-live={role === "status" ? "polite" : "assertive"}
        aria-atomic="true"
        tabIndex={role === "alert" ? -1 : undefined}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center text-[var(--color-text-primary)] hover:shadow-md transition-shadow"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{detail}</p>
        {role === "alert" && <TrustNotice />}
        {onRetry && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {directUrl && (
              <a
                href={directUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded text-sm font-medium text-[var(--color-text-link)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
              >
                Open VS Code in a new tab
              </a>
            )}
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
            >
              Retry VS Code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Dedicated VS Code audience in the same per-user runtime as OpenCode.
 */
export default function VSCodeFrame() {
  const [frameError, setFrameError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const frameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { workspace } = useRuntime();
  const launch = useRuntimeLaunch("vscode", workspace);

  const clearFrameTimeout = () => {
    if (frameTimeoutRef.current !== null) {
      clearTimeout(frameTimeoutRef.current);
      frameTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    if (launch.status !== "ready" || launch.url === null || frameError !== null) return;

    if (frameTimeoutRef.current !== null) clearTimeout(frameTimeoutRef.current);
    frameTimeoutRef.current = setTimeout(() => {
      setFrameError("VS Code did not respond before the local iframe timeout.");
      frameTimeoutRef.current = null;
    }, VSCODE_FRAME_TIMEOUT_MS);

    return () => {
      if (frameTimeoutRef.current !== null) {
        clearTimeout(frameTimeoutRef.current);
        frameTimeoutRef.current = null;
      }
    };
  }, [launch.status, launch.url, frameError, retryNonce]);

  useEffect(() => {
    if (launch.status === "unavailable" || launch.status === "expired" || frameError !== null) {
      alertRef.current?.focus();
    }
  }, [launch.status, frameError]);

  const retry = () => {
    clearFrameTimeout();
    setFrameError(null);
    setRetryNonce((value) => value + 1);
    launch.retry();
  };

  if (workspace.status !== "ready") {
    return <RuntimeWorkspacePicker controller={workspace} product="VS Code" />;
  }

  if (launch.status === "loading" || launch.status === "starting") {
    return (
      <FrameNotice
        noticeRef={alertRef}
        role="status"
        title={launch.status === "loading" ? "Preparing VS Code" : "VS Code is starting"}
        detail={launch.error ?? "Allocating the VS Code audience in your isolated runtime…"}
      />
    );
  }

  if (launch.status !== "ready" || launch.url === null || frameError !== null) {
    return <FrameNotice noticeRef={alertRef} role="alert" title={frameError ? "VS Code could not be loaded" : launch.status === "expired" ? "VS Code launch expired" : "VS Code is unavailable"} detail={frameError ?? launch.error ?? "VS Code is unavailable."} onRetry={retry} directUrl={launch.url} />;
  }

  // Deliberately unsandboxed: this is the fixed trusted separate-origin local gateway.
  return (
    <iframe
      key={retryNonce}
      src={launch.url}
      title="VS Code"
      allow="clipboard-write"
      loading="eager"
      className="absolute inset-0 h-full w-full border-0"
      onLoad={clearFrameTimeout}
      onError={() => {
        clearFrameTimeout();
        setFrameError("VS Code could not be reached through the local gateway.");
      }}
    />
  );
}
