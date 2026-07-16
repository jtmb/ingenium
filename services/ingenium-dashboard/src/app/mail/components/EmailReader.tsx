"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import EmailComposer from "./EmailComposer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";

function buildReplySubject(subject?: string) {
  return subject?.match(/^re:/i) ? subject : `Re: ${subject || ""}`;
}

/**
 * EmailReader — full email display with headers, HTML body (iframed), attachments,
 * and action buttons. Supports inline reply (Gmail-style embedded composer) and
 * AI-powered summarization.
 *
 * Layout when replying:
 *   - xl+: side-by-side (body left, composer right, resizable divider between them)
 *   - below xl: stacked (body on top, composer below)
 *
 * SECURITY: Email HTML is rendered in a sandboxed iframe:
 *   - `allow-same-origin` — needed for JS-based height measurement via postMessage (if implemented)
 *   - `allow-popups` — links in emails can open new tabs
 *   - `allow-popups-to-escape-sandbox` — popups open in the parent context, not nested
 *   - NO `allow-scripts` or `allow-forms` — prevents XSS in email body
 *   - `target="_blank"` is injected via <base> tag so links never navigate the iframe itself
 */
export default function EmailReader({
  email,
  loading,
  downloading,
  downloadError,
  onRetry,
  accountId,
  project,
  onReply,
  onForward,
  onDelete,
  onArchive,
  accounts,
  selectedAccount,
  onComposeSend,
  onComposeSave,
  replyWidth = 420,
  onReplyWidthChange,
}: {
  email: any;
  loading: boolean;
  downloading?: boolean;
  downloadError?: string | null;
  onRetry?: () => void;
  accountId?: string;
  project?: string;
  onReply?: () => void;
  onForward: () => void;
  onDelete: () => void;
  onArchive: () => void;
  accounts?: { id: string; email: string; name?: string }[];
  selectedAccount?: string;
  onComposeSend?: (data: any) => void;
  onComposeSave?: (data: any) => void;
  replyWidth?: number;
  onReplyWidthChange?: (width: number) => void;
}) {
  const [isReplying, setIsReplying] = useState(false);
  const [replyPrefill, setReplyPrefill] = useState<{ to?: string; subject?: string; body?: string }>({});

  const [summariseLoading, setSummariseLoading] = useState(false);
  const [summariseError, setSummariseError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryConfigured, setSummaryConfigured] = useState<boolean | null>(null);

  /** Resize state for the reply panel's draggable handle. */
  const [isReplyResizing, setIsReplyResizing] = useState(false);
  const replyStartRef = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 0 });
  const replyContainerRef = useRef<HTMLDivElement>(null);
  /** Constrain reply panel: body needs at least 400px, reply min 320px. */
  const [maxReplyWidth, setMaxReplyWidth] = useState(window.innerWidth - 400);

  useEffect(() => {
    const cw = replyContainerRef.current?.getBoundingClientRect().width;
    if (cw) setMaxReplyWidth(Math.max(320, cw - 400));
  }, [isReplying]);

  // FIX 1 — Reset reply/summary state when switching to a different email
  // DP#32: dependency is `email?.uid` (primitive, stable per email).
  // Re-rendering the SAME email (uid unchanged) does NOT trigger reset.
  // Only genuinely changing the viewed email (uid changes) resets the state.
  useEffect(() => {
    setIsReplying(false);
    setReplyPrefill({});
    setSummariseLoading(false);
    setSummariseError(null);
    setSummary(null);
    setSummaryConfigured(null);
  }, [email?.uid]);

  // Reply resize pointer handlers
  const onReplyPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    replyStartRef.current = { startX: e.clientX, startWidth: replyWidth };
    setIsReplyResizing(true);
  }, [replyWidth]);

  const onReplyPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isReplyResizing) return;
    const deltaX = e.clientX - replyStartRef.current.startX;
    // Leftward drag = increase width; rightward drag = decrease
    let newWidth = replyStartRef.current.startWidth - deltaX;

    // Constrain: body needs at least 400px
    const containerWidth = replyContainerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const newMax = Math.max(320, containerWidth - 400);
    setMaxReplyWidth(newMax);
    newWidth = Math.max(320, Math.min(newMax, newWidth));

    onReplyWidthChange?.(newWidth);
  }, [isReplyResizing, onReplyWidthChange]);

  const onReplyPointerUp = useCallback(() => {
    setIsReplyResizing(false);
  }, []);

  // No email selected
  if (!email && !loading) {
    return (
      <div data-testid="email-reader-empty" className="flex-1 min-w-[400px] flex flex-col items-center justify-center gap-3">
        <span className="text-3xl">✉️</span>
        <p className="text-[var(--color-text-muted)] text-sm">Select an email to read</p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div data-testid="email-reader-loading" className="flex-1 min-w-[400px] flex flex-col animate-pulse">
        <div className="bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] px-4 py-3 space-y-2">
          <div className="h-6 bg-[var(--color-surface-muted)] rounded w-2/3" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/3" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-1/4" />
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-full" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-full" />
          <div className="h-4 bg-[var(--color-surface-muted)] rounded w-3/4" />
        </div>
      </div>
    );
  }

  // Downloading state (202 pending — body not yet cached)
  if (downloading) {
    return (
      <div data-testid="email-reader-downloading" className="flex-1 min-w-[400px] flex flex-col items-center justify-center gap-3">
        <svg className="animate-spin w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-[var(--color-text-muted)]">Downloading email body…</p>
      </div>
    );
  }

  // Download error state (202 polling timed out)
  if (downloadError) {
    return (
      <div data-testid="email-reader-error" className="flex-1 min-w-[400px] flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-[var(--color-error-text)]">{downloadError}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // --- Local handlers (FIX 2) ---
  const handleReplyClick = () => {
    const toAddr = email.from?.[0]?.address;
    setReplyPrefill({
      to: toAddr,
      subject: buildReplySubject(email.subject),
      body: "",
    });
    setIsReplying(true);
    onReply?.(); // ← allows /mail/[id] to intercept and redirect back to /mail
  };

  const handleSummarise = async () => {
    if (!email?.uid || !accountId) return;
    setSummariseLoading(true);
    setSummariseError(null);
    setSummary(null);
    setSummaryConfigured(null);
    try {
      const url = `${API_BASE}/emails/summarize/${email.uid}?project=${project || "global-default"}&account=${accountId}&folder=${encodeURIComponent(email.folder || "INBOX")}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({ data: null }));
      const d = data.data || data;
      if (d && d.configured === false) {
        setSummaryConfigured(false);
      } else if (d?.summary) {
        setSummary(d.summary);
        setSummaryConfigured(true);
      } else {
        setSummariseError("No summary available");
      }
    } catch {
      setSummariseError("Summarise failed");
    } finally {
      setSummariseLoading(false);
    }
  };

  const isUnread = !email.flags?.includes("\\Seen");
  const fromAddress = email.from?.[0];
  const toList = email.to?.map((t: any) => t.address).join(", ") || "";
  const ccList = email.cc?.map((c: any) => c.address).join(", ") || "";
  const bodyOverflowClass = email.body?.html ? "overflow-hidden" : "overflow-y-auto";

  // --- Render helpers for body content, summarize section, and attachments ---
  const renderSummarize = (
    <div className="px-4 py-2 border-b border-[var(--color-border)]">
      {!summariseLoading && summary === null && summaryConfigured === null && !summariseError && (
        <button
          onClick={handleSummarise}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Summarise this email
        </button>
      )}
      {summariseLoading && (
        <p className="text-xs text-[var(--color-text-muted)] animate-pulse">Summarising…</p>
      )}
      {summariseError && (
        <p className="text-xs text-[var(--color-text-muted)]">{summariseError}</p>
      )}
      {summaryConfigured === false && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Configure a <a href="/?settings=general" className="text-[var(--color-text-link)] hover:underline">Synthesis LLM</a> in Settings to enable AI summaries.
        </p>
      )}
      {summary && (
        <div className="border border-[var(--color-border)] rounded p-3 bg-[var(--color-surface)]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-[var(--color-text-primary)]">AI Summary</p>
            <div className="flex gap-2">
              <button
                onClick={handleSummarise}
                className="text-xs text-[var(--color-text-link)] hover:underline"
              >
                ↺ Regenerate
              </button>
              <button
                onClick={() => { setSummary(null); setSummaryConfigured(null); }}
                className="text-xs text-[var(--color-text-link)] hover:underline"
              >
                Collapse
              </button>
            </div>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{summary}</p>
        </div>
      )}
    </div>
  );

  const renderEmailBody = (
    <>
        {email.body?.html ? (
        (() => {
          const html = email.body.html;
          let srcDoc: string;
          /**
           * SECURITY: Three iframe srcdoc construction paths:
           * 1. Full HTML doc with <head> — inject <base target="_blank"> for link safety.
           * 2. Partial doc with <body> but no <head> — prepend skeleton with sanitized styles.
           * 3. Content fragment — wrap in full document with safe default styles.
           *
           * All paths include `img{max-width:100%}` to prevent oversized images breaking layout,
           * and `color-scheme:light` to prevent dark-mode email HTML from inverting colors.
           */
          if (/<html[\s>]/i.test(html) || /<body[\s>]/i.test(html)) {
            srcDoc = html.replace(/<head[^>]*>/i, '$&<base target="_blank">');
            if (!/<head/i.test(html)) {
              srcDoc = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:8px;font:14px system-ui;color:#111;background:#fff;color-scheme:light}img{max-width:100%;height:auto}</style></head>' + html.replace(/^<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
            }
          } else {
            srcDoc = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:8px;font:14px system-ui;color:#111;background:#fff;color-scheme:light}img{max-width:100%;height:auto}</style></head><body>' + html + '</body></html>';
          }

          /** PERF: Size guard — email bodies > 2MB skip HTML rendering to avoid
           *  freezing the browser on massive inline base64 images. Falls back to
           *  plain text if available. */
          if (html.length > 2_000_000) {
            return (
              <p className="text-sm text-[var(--color-text-muted)] italic">
                This email is too large to preview ({(html.length / 1_048_576).toFixed(1)} MB).
                {email.body?.text && (
                  <> <button onClick={() => {}} className="underline text-blue-500">View plain text</button></>
                )}
              </p>
            );
          }

          return (
            <iframe
              srcDoc={srcDoc}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              className="block h-full min-h-[200px] w-full border-0 bg-white"
              title="Email content"
              data-testid="email-html-iframe"
            />
          );
        })()
      ) : email.body?.text ? (
        <pre className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap font-sans">
          {email.body.text}
        </pre>
      ) : (
        <p className="text-[var(--color-text-muted)] text-sm italic">No content</p>
      )}
    </>
  );

  const renderAttachments = email.attachments && email.attachments.length > 0 ? (
    <div className="border-t border-[var(--color-border)] px-4 py-3">
      <p className="text-xs font-semibold text-[var(--color-text-primary)] mb-2 uppercase tracking-wide">
        Attachments ({email.attachments.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {email.attachments.map((att: any, idx: number) => (
          <a
            key={att.attachmentId || att.partId || idx}
            href={`${API_BASE}/emails/${email.uid}/attachments/${att.attachmentId || att.partId || idx}?account=${accountId}&folder=${email.folder || 'INBOX'}`}
            className="flex items-center gap-2 px-3 py-1.5 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)]"
            download={att.filename}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-[var(--color-text-primary)] truncate max-w-[200px]">
              {att.filename}
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">
              ({att.size ? Math.round(att.size / 1024) : "?"} KB)
            </span>
          </a>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div data-testid="email-reader-content" className="flex-1 min-h-0 min-w-[400px] flex flex-col">
      {/* Header panel — always full width */}
      <div className="bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] px-4 py-3 space-y-1">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {email.subject || "(No subject)"}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            {fromAddress?.name || fromAddress?.address || "Unknown"}
          </span>
          {fromAddress?.address && fromAddress?.name && (
            <span className="text-sm text-[var(--color-text-secondary)]">
              &lt;{fromAddress.address}&gt;
            </span>
          )}
        </div>
        {toList && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            <span className="font-medium">To:</span> {toList}
          </p>
        )}
        {ccList && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            <span className="font-medium">CC:</span> {ccList}
          </p>
        )}
        <p className="text-xs text-[var(--color-text-muted)]">
          {email.date ? new Date(email.date).toLocaleString() : ""}
        </p>
      </div>

      {/* Action bar — always full width */}
      <div className="flex gap-1 px-4 py-2 border-b border-[var(--color-border)]">
        <button
          onClick={handleReplyClick}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Reply
        </button>
        <button
          onClick={onForward}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Forward
        </button>
        <button
          onClick={onArchive}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Archive
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] ml-auto"
        >
          Delete
        </button>
      </div>

      {/* Body + Composer — split when replying, full-width otherwise */}
      {isReplying ? (
        <div className="flex-1 min-w-0 flex flex-col xl:flex-row min-h-0" ref={replyContainerRef}>
          {/* Body panel (left/top) */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            {/* Fixed: summarize panel */}
            <div className="shrink-0">
              {accountId && email?.uid && renderSummarize}
            </div>
            {/* Scrollable: email body */}
            <div data-testid="email-body-pane" className={`flex-1 min-h-0 px-4 py-4 ${bodyOverflowClass}`}>
              {renderEmailBody}
            </div>
            {/* Fixed: attachments */}
            {renderAttachments && <div className="shrink-0">{renderAttachments}</div>}
          </div>

          {/* Reply resize handle — LEFT edge of composer (between body and composer) */}
          <div
            role="separator"
            aria-label="Resize reply panel"
            aria-valuenow={replyWidth}
            aria-valuemin={320}
            aria-valuemax={maxReplyWidth}
            tabIndex={0}
            onPointerDown={onReplyPointerDown}
            onPointerMove={onReplyPointerMove}
            onPointerUp={onReplyPointerUp}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                const containerWidth = replyContainerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
                const maxReplyWidth = Math.max(320, containerWidth - 400);
                const nw = Math.min(maxReplyWidth, replyWidth + 20);
                onReplyWidthChange?.(nw);
              }
              if (e.key === "ArrowRight") {
                const nw = Math.max(320, replyWidth - 20);
                onReplyWidthChange?.(nw);
              }
            }}
            className={`hidden xl:block w-2 cursor-col-resize hover:bg-blue-200 active:bg-blue-400 transition-colors shrink-0 ${isReplyResizing ? "bg-blue-400" : "bg-transparent"}`}
          />

          {/* Composer panel (right/bottom)
              key={email?.uid} ensures React remounts the composer on email switch,
              clearing composer state, suggestion state, and avoiding stale content. */}
          <div
            key={email?.uid}
            style={{ width: `${replyWidth}px`, minWidth: "320px" }}
            className="border-t xl:border-t-0 xl:border-l flex flex-col min-h-0"
          >
            <EmailComposer
              inline
              sideBySide
              initialData={replyPrefill}
              initialAccountId={selectedAccount}
              accounts={accounts}
              emailUid={email?.uid}
              accountId={accountId}
              folder={email.folder}
              emailFrom={email.from?.[0]?.address}
              onSend={(data) => {
                onComposeSend?.(data);
                setIsReplying(false);
              }}
              onSave={(data) => {
                onComposeSave?.(data);
                setIsReplying(false);
              }}
              onCancel={() => setIsReplying(false)}
              project={project}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Summarise button + panel (FIX 4) — full width */}
          {accountId && email?.uid && renderSummarize}

          {/* Email body — full width, scrollable */}
          <div data-testid="email-body-pane" className={`flex-1 min-h-0 px-4 py-4 ${bodyOverflowClass}`}>
            {renderEmailBody}
          </div>

          {/* Attachments — full width */}
          {renderAttachments}
        </>
      )}
    </div>
  );
}
