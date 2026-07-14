/**
 * Thin fetch client for Gmail REST API (gmail.googleapis.com/gmail/v1).
 *
 * All functions accept a ready-to-use `token: string`. The caller is responsible
 * for ensuring the token is fresh (use `getFreshGmailToken` from oauth.ts).
 *
 * Errors are thrown with HTTP status + body detail. No error-sentinel pattern —
 * callers catch at the provider boundary.
 *
 * 🔴 Lesson 14: Any unhandled HTTP errors include the response body in the
 * error message so failures are diagnosable from logs alone.
 */

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

// ── Internal helpers ────────────────────────────────────────────────────────

interface GmailRequestOptions {
  method?: string;
  body?: string | URLSearchParams;
  headers?: Record<string, string>;
  /** If set, the response is streamed and parsed as JSON. */
  parseJson?: boolean;
}

async function gmailRequest<T>(
  token: string,
  path: string,
  opts: GmailRequestOptions = {},
): Promise<T> {
  const url = `${GMAIL_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    ...opts.headers,
  };

  if (opts.body instanceof URLSearchParams) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (typeof opts.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const method = opts.method ?? "GET";
  const requestInit: RequestInit = { method, headers };

  if (opts.body !== undefined) {
    requestInit.body = typeof opts.body === "string"
      ? opts.body
      : (opts.body as URLSearchParams).toString();
  }

  let res: Response;
  try {
    res = await fetch(url, requestInit);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gmail API fetch failed for ${method} ${path}: ${msg}`);
  }

  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }
    throw new Error(
      `Gmail API ${method} ${path} returned ${res.status} ${res.statusText}` +
      (body ? ` — ${body.slice(0, 500)}` : ""),
    );
  }

  // 204 No Content — no body to parse
  if (res.status === 204) return undefined as T;

  // Read as text, parse manually (avoids ReadableStream issues)
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Get the authenticated user's Gmail profile. */
export async function getProfile(
  token: string,
): Promise<{ emailAddress: string; historyId: string }> {
  return gmailRequest<{ emailAddress: string; historyId: string }>(
    token,
    "/users/me/profile",
  );
}

/** List all labels for the authenticated user. */
export async function listLabels(
  token: string,
): Promise<{ id: string; name: string; type: string }[]> {
  // labels.list returns up to 100 by default; Gmail has a ~50 label limit, so no pagination needed
  const res = await gmailRequest<{ labels: { id: string; name: string; type: string }[] }>(
    token,
    "/users/me/labels",
  );
  return res.labels ?? [];
}

/** List message IDs for a label. Supports pagination via pageToken. */
export async function listMessages(
  token: string,
  labelId: string,
  maxResults: number,
  pageToken?: string,
): Promise<{ messages: { id: string }[]; nextPageToken?: string }> {
  const params = new URLSearchParams();
  params.set("labelIds", labelId);
  params.set("maxResults", String(maxResults));
  if (pageToken) params.set("pageToken", pageToken);

  return gmailRequest<{ messages: { id: string }[]; nextPageToken?: string }>(
    token,
    `/users/me/messages?${params.toString()}`,
  );
}

/**
 * Fetch full message details for multiple IDs.
 *
 * Uses sequential individual GET calls (not the Gmail batch endpoint) for
 * simplicity. For initial sync of 500 messages, sequential is fine (~20s).
 * Each message.get costs 5 quota units out of 250/sec.
 */
export async function batchGetMessages(
  token: string,
  ids: string[],
  format: "metadata" | "full" | "minimal" = "metadata",
): Promise<any[]> {
  const results: any[] = [];
  for (const id of ids) {
    try {
      const msg = await gmailRequest<any>(
        token,
        `/users/me/messages/${id}?format=${format}`,
      );
      results.push(msg);
    } catch (err: unknown) {
      // Skip individual failures — log and continue
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Gmail API: failed to get message ${id}: ${msg}`);
    }
  }
  return results;
}

/** Get a single message by ID (used when batch isn't needed). */
export async function getMessage(
  token: string,
  id: string,
  format: "metadata" | "full" | "minimal" = "full",
): Promise<any> {
  return gmailRequest<any>(
    token,
    `/users/me/messages/${id}?format=${format}`,
  );
}

/** Get history changes since a given historyId. */
export async function getHistory(
  token: string,
  startHistoryId: string,
): Promise<{ history?: any[]; nextPageToken?: string; historyId: string }> {
  const params = new URLSearchParams();
  params.set("startHistoryId", startHistoryId);

  // history.list may paginate; fetch all pages
  const allHistory: any[] = [];
  let nextPageToken: string | undefined;

  do {
    if (nextPageToken) params.set("pageToken", nextPageToken);
    const res = await gmailRequest<{
      history?: any[];
      nextPageToken?: string;
      historyId: string;
    }>(
      token,
      `/users/me/history?${params.toString()}`,
    );

    if (res.history) allHistory.push(...res.history);
    nextPageToken = res.nextPageToken;

    // Return after first page if no more pages; include historyId from first response
    if (!nextPageToken) {
      return { history: allHistory, historyId: res.historyId };
    }
  } while (nextPageToken);

  // Shouldn't reach here, but satisfy TypeScript
  return { history: allHistory, historyId: "" };
}

/** Get an attachment by messageId + attachmentId. */
export async function getAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<{ data: string; size: number }> {
  return gmailRequest<{ data: string; size: number }>(
    token,
    `/users/me/messages/${messageId}/attachments/${attachmentId}`,
  );
}

/** Send a raw RFC822 message (base64url-encoded). */
export async function sendMessage(
  token: string,
  raw: string,
): Promise<{ id: string }> {
  return gmailRequest<{ id: string }>(
    token,
    "/users/me/messages/send",
    {
      method: "POST",
      body: JSON.stringify({ raw }),
    },
  );
}

/** Modify labels on a message (add/remove label IDs). */
export async function modifyMessage(
  token: string,
  id: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  const body: Record<string, string[]> = {};
  if (addLabelIds?.length) body.addLabelIds = addLabelIds;
  if (removeLabelIds?.length) body.removeLabelIds = removeLabelIds;

  await gmailRequest<void>(
    token,
    `/users/me/messages/${id}/modify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}
