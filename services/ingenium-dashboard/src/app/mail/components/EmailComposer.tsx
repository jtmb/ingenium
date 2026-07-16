"use client";

import { useState, useRef, useEffect } from "react";
import SmartSuggest from "./SmartSuggest";
import RichTextEditor, { RichTextEditorHandle } from "./RichTextEditor";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";

/** Escape plain text for safe insertion as HTML content */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Convert plain text to safe HTML paragraphs */
function plainTextToHtml(text: string): string {
  const escaped = escapeHtml(text);
  const paragraphs = escaped.split(/\n\n+/);
  return paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>") || "<br>"}</p>`).join("");
}

/**
 * Strip HTML tags, decode common entities, trim whitespace.
 * Used to extract plain text from the editor's HTML output before sending
 * the `text/plain` part of the email and before sending to the AI review endpoint.
 * WARNING: This is a best-effort heuristic — does not handle all HTML entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * EmailComposer — simple compose form with From/To/CC/BCC/Subject/Body.
 * Uses RichTextEditor (TipTap) for HTML body composition.
 *
 * When `inline={true}`, renders a compact Gmail-inspired reply box
 * (tighter spacing, single-line fields, smaller editor).
 * When `inline` is falsy/undefined, renders the full modal layout unchanged.
 *
 * When `sideBySide={true}` (only valid with `inline`), the composer's
 * background/padding/rounded wrapper is removed — the parent panel in
 * EmailReader handles the positioning.
 */
export default function EmailComposer({
  initialData,
  initialAccountId,
  accounts,
  onSend,
  onSave,
  onCancel,
  inline,
  sideBySide,
  project,
  emailUid,
  accountId,
  folder,
  emailFrom,
}: {
  initialData?: { to?: string; subject?: string; body?: string };
  initialAccountId?: string;
  accounts?: { id: string; email: string; name?: string }[];
  onSend: (data: any) => void;
  onSave: (data: any) => void;
  onCancel: () => void;
  inline?: boolean;
  sideBySide?: boolean;
  project?: string;
  emailUid?: string;
  accountId?: string;
  folder?: string;
  emailFrom?: string;
}) {
  const [to, setTo] = useState(initialData?.to || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(initialData?.subject || "");
  const [htmlBody, setHtmlBody] = useState(initialData?.body ? plainTextToHtml(initialData.body) : "");
  const [fromAccount, setFromAccount] = useState(initialAccountId || "");

  // RichTextEditor ref for imperative API access
  const editorRef = useRef<RichTextEditorHandle>(null);

  /**
   * Smart replies mode — fetched from mail_smart_replies_mode setting.
   * "auto" (default): suggestions fetch automatically when email changes.
   * "manual": user clicks "Generate Suggestions" to trigger the fetch.
   * NOTE: This setting is project-scoped, cached on mount, not re-fetched per email. */
  const [smartRepliesMode, setSmartRepliesMode] = useState<"auto" | "manual">("auto");

  useEffect(() => {
    if (!project) return;
    fetch(
      `${API_BASE}/settings?project=${encodeURIComponent(project)}&key=mail_smart_replies_mode`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const val = d?.data?.value;
        if (val === "manual") setSmartRepliesMode("manual");
        else setSmartRepliesMode("auto");
      })
      .catch(() => {});
  }, [project]);

  // Review with AI state
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<{ improved: string; configured: boolean } | null>(null);

  const plainText = stripHtml(htmlBody);

  const formData = {
    to,
    cc: showCc ? cc : "",
    bcc: showBcc ? bcc : "",
    subject,
    accountId: fromAccount,
    html: htmlBody,
    text: plainText,
  };

  const handleReview = async () => {
    setReviewLoading(true);
    setReviewError(null);
    setReviewResult(null);
    try {
      const res = await fetch(`${API_BASE}/emails/review-draft?project=${project || "global-default"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: plainText, subject }),
      });
      const data = await res.json().catch(() => ({ data: null }));
      const d = data.data || data;
      if (d && d.configured === false) {
        setReviewResult({ improved: "", configured: false });
      } else if (d?.improved) {
        setReviewResult({ improved: d.improved, configured: true });
      } else {
        setReviewError("No improvement available");
      }
    } catch {
      setReviewError("Review failed — try again later");
    } finally {
      setReviewLoading(false);
    }
  };

  /** Applies the AI-improved text by re-wrapping as HTML (plainTextToHtml escapes first).
   *  SECURITY: Never set raw AI output as innerHTML — always escape through plainTextToHtml
   *  which calls escapeHtml() to prevent XSS from generated content. */
  const applyReview = (improved: string) => {
    setHtmlBody(plainTextToHtml(improved));
    setReviewResult(null);
  };

  /**
   * INLINE VARIANT — compact, Gmail-inspired reply box.
   * Used in the EmailReader's side-by-side mode. Shorter fields, no labels above inputs,
   * RichTextEditor with a smaller min-height. Shows SmartSuggest cards_variant when
   * emailUid/accountId are provided. */
  if (inline) {
    const wrapperClass = sideBySide
      ? "flex-1 overflow-y-auto px-3 py-2 space-y-2"
      : "space-y-2 bg-[var(--color-surface-muted)] p-3 rounded";

    return (
      <div className={wrapperClass}>
        {/* From — compact single-line */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)] w-8 shrink-0">From</span>
          <select
            className="flex-1 border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            value={fromAccount}
            onChange={(e) => setFromAccount(e.target.value)}
          >
            <option value="">Select</option>
            {accounts?.map((acct) => (
              <option key={acct.id} value={acct.id}>
                {acct.email}
              </option>
            ))}
          </select>
        </div>

        {/* To — compact single-line */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)] w-8 shrink-0">To</span>
          <input
            type="text"
            placeholder="recipient@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="flex-1 border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>

        {/* CC/BCC toggles */}
        <div className="flex gap-4 text-sm pl-10">
          <button
            type="button"
            onClick={() => setShowCc(!showCc)}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            {showCc ? "− CC" : "+ CC"}
          </button>
          <button
            type="button"
            onClick={() => setShowBcc(!showBcc)}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            {showBcc ? "− BCC" : "+ BCC"}
          </button>
        </div>

        {showCc && (
          <div className="flex items-center gap-2 pl-10">
            <span className="text-xs text-[var(--color-text-muted)] w-8 shrink-0">CC</span>
            <input
              type="text"
              placeholder="CC"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="flex-1 border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
          </div>
        )}

        {showBcc && (
          <div className="flex items-center gap-2 pl-10">
            <span className="text-xs text-[var(--color-text-muted)] w-8 shrink-0">BCC</span>
            <input
              type="text"
              placeholder="BCC"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              className="flex-1 border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
          </div>
        )}

        {/* Subject — compact single-line */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)] w-8 shrink-0">Subj</span>
          <input
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>

        {/* Body — RichTextEditor */}
        <div>
          <RichTextEditor
            ref={editorRef}
            value={htmlBody}
            onChange={setHtmlBody}
            placeholder="Write your message..."
            minHeight="120px"
          />
        </div>

        {/* Review with AI button + panel (shared between variants) */}
        {!reviewLoading && !reviewResult && !reviewError && (
          <button
            onClick={handleReview}
            className="text-xs text-[var(--color-text-link)] hover:underline self-start"
          >
            Review with AI
          </button>
        )}
        {reviewLoading && (
          <p className="text-xs text-[var(--color-text-muted)] animate-pulse">Reviewing…</p>
        )}
        {reviewError && (
          <p className="text-xs text-[var(--color-text-muted)]">{reviewError}</p>
        )}
        {reviewResult && reviewResult.configured === false && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Configure a <a href="/?settings=general" className="text-[var(--color-text-link)] hover:underline">Synthesis LLM</a> in Settings to enable AI review.
          </p>
        )}
        {reviewResult && reviewResult.improved && (
          <div className="space-y-2 border border-[var(--color-border)] rounded p-3 bg-[var(--color-surface)]">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">Original</p>
                <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap font-sans bg-[var(--color-surface-muted)] p-2 rounded">
                  {plainText}
                </pre>
              </div>
              <div>
                <p className="text-xs font-semibold text-green-600 mb-1">Improved</p>
                <pre className="text-xs text-[var(--color-text-primary)] whitespace-pre-wrap font-sans bg-green-50 dark:bg-green-900/20 p-2 rounded">
                  {reviewResult.improved}
                </pre>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => applyReview(reviewResult.improved)}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
              >
                Apply
              </button>
              <button
                onClick={() => setReviewResult(null)}
                className="px-2 py-1 text-xs border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Smart Suggestions — cards variant. Hidden when emailUid/accountId not provided
            (e.g., composing a new message from scratch rather than replying). */}
        {emailUid && accountId && (
          <SmartSuggest
            emailUid={emailUid}
            accountId={accountId}
            folder={folder}
            mode={smartRepliesMode}
            variant="cards"
            onDraft={(draft) => {
              setSubject(draft.subject);
              // Safety: escape plain text before inserting as HTML
              setHtmlBody(plainTextToHtml(draft.body));
            }}
          />
        )}

        {/* Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onSend(formData)}
            className="bg-blue-600 text-white py-1.5 px-3 rounded text-sm font-medium"
          >
            Send
          </button>
          <button
            onClick={() => onSave(formData)}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-1.5 px-3 rounded text-sm font-medium"
          >
            Save Draft
          </button>
          <button
            onClick={onCancel}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-1.5 px-3 rounded text-sm font-medium ml-auto"
          >
            Discard
          </button>
        </div>
      </div>
    );
  }

  // ———— MODAL VARIANT ————
  return (
    <div className="space-y-4 w-full">
      {/* From */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">From</label>
        <select
          className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
          value={fromAccount}
          onChange={(e) => setFromAccount(e.target.value)}
        >
          <option value="">Select account</option>
          {accounts?.map((acct) => (
            <option key={acct.id} value={acct.id}>
              {acct.email}
            </option>
          ))}
        </select>
      </div>

      {/* To */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">To</label>
        <input
          type="text"
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      {/* CC/BCC toggles */}
      <div className="flex gap-4 text-sm">
        <button
          type="button"
          onClick={() => setShowCc(!showCc)}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          {showCc ? "− CC" : "+ CC"}
        </button>
        <button
          type="button"
          onClick={() => setShowBcc(!showBcc)}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          {showBcc ? "− BCC" : "+ BCC"}
        </button>
      </div>

      {showCc && (
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">CC</label>
          <input
            type="text"
            placeholder="CC"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      )}

      {showBcc && (
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">BCC</label>
          <input
            type="text"
            placeholder="BCC"
            value={bcc}
            onChange={(e) => setBcc(e.target.value)}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      )}

      {/* Subject */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Subject</label>
        <input
          type="text"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
      </div>

      {/* Body — RichTextEditor */}
      <div className="min-h-[50vh] flex flex-col">
        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1 shrink-0">Message</label>
        <div className="flex-1">
          <RichTextEditor
            ref={editorRef}
            value={htmlBody}
            onChange={setHtmlBody}
            placeholder="Write your message..."
            minHeight="200px"
          />
        </div>
      </div>

      {/* Review with AI button + panel (shared between variants) */}
      {!reviewLoading && !reviewResult && !reviewError && (
        <button
          onClick={handleReview}
          className="text-sm text-[var(--color-text-link)] hover:underline"
        >
          Review with AI
        </button>
      )}
      {reviewLoading && (
        <p className="text-sm text-[var(--color-text-muted)] animate-pulse">Reviewing…</p>
      )}
      {reviewError && (
        <p className="text-sm text-[var(--color-text-muted)]">{reviewError}</p>
      )}
      {reviewResult && reviewResult.configured === false && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Configure a <a href="/?settings=general" className="text-[var(--color-text-link)] hover:underline">Synthesis LLM</a> in Settings to enable AI review.
        </p>
      )}
      {reviewResult && reviewResult.improved && (
        <div className="space-y-2 border border-[var(--color-border)] rounded p-3 bg-[var(--color-surface)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-muted)] mb-1">Original</p>
              <pre className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap font-sans bg-[var(--color-surface-muted)] p-2 rounded max-h-[200px] overflow-y-auto">
                {plainText}
              </pre>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-600 mb-1">Improved</p>
              <pre className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap font-sans bg-green-50 dark:bg-green-900/20 p-2 rounded max-h-[200px] overflow-y-auto">
                {reviewResult.improved}
              </pre>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => applyReview(reviewResult.improved)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded"
            >
              Apply
            </button>
            <button
              onClick={() => setReviewResult(null)}
              className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => onSend(formData)}
          className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
        >
          Send
        </button>
        <button
          onClick={() => onSave(formData)}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-2 px-4 rounded text-sm font-medium"
        >
          Save Draft
        </button>
        <button
          onClick={onCancel}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] py-2 px-4 rounded text-sm font-medium ml-auto"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
