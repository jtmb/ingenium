/**
 * MCP tool handlers for email operations.
 * Provides 27 tools: 7 basic + 6 self-learning + 14 admin/operations tools.
 * Logs observations to the self-learning pipeline as a side effect.
 */
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { api } from "../client.js";
import { config } from "../../config/index.js";

/** Validated workspace-bounded path for attachment downloads. */
const WORKSPACE_ROOT = "/workspace";
const HOME_ROOT = process.env.HOME ?? "/home/appuser";
const FORBIDDEN_PREFIXES = ["/etc", "/root", "/proc", "/sys", "/dev", "/tmp"];

function validateSafePath(outputPath: string): string {
  const resolved = path.resolve(outputPath);
  // Must be within workspace or home, not in a forbidden location
  const isInWorkspace = resolved === WORKSPACE_ROOT || resolved.startsWith(WORKSPACE_ROOT + "/");
  const isInHome = resolved === HOME_ROOT || resolved.startsWith(HOME_ROOT + "/");
  if (!isInWorkspace && !isInHome) {
    throw new Error(
      `Path "${outputPath}" resolves to "${resolved}" — must be within ${WORKSPACE_ROOT} or ${HOME_ROOT}`,
    );
  }
  const forbidden = FORBIDDEN_PREFIXES.find((p) => resolved === p || resolved.startsWith(p + "/"));
  if (forbidden) {
    throw new Error(`Path "${outputPath}" resolves to a forbidden location (${forbidden})`);
  }
  return resolved;
}

// ── Basic Email Tools ──────────────────────────────────────────────────────

/** List emails in a folder with pagination */
export async function emailList(project: string, account: string, folder?: string, page?: number) {
  const res = await api.get("/emails", {
    project, account,
    folder: folder ?? "INBOX",
    page: String(page ?? 1),
    limit: "20",
  });
  await api.post("/observations", {
    observation_type: "behavior",
    content: `Agent listed emails in ${folder ?? "INBOX"} for account ${account}`,
    importance: 3,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Search emails by keyword, sender, subject, or date range */
export async function emailSearch(project: string, account: string, query: string, folder?: string) {
  const res = await api.get("/emails/search", {
    project, account,
    q: query,
    folder: folder ?? "INBOX",
  });
  await api.post("/observations", {
    observation_type: "research",
    content: `Agent searched emails for "${query}"`,
    importance: 5,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Read a full email by its UID */
export async function emailRead(project: string, account: string, uid: number, folder?: string) {
  const res = await api.get(`/emails/${uid}`, {
    project, account,
    folder: folder ?? "INBOX",
  });
  await api.post("/observations", {
    observation_type: "behavior",
    content: `Agent read email #${uid} from ${folder ?? "INBOX"}`,
    importance: 3,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Compose and send an email */
export async function emailSend(
  project: string, account: string, to: string, subject: string,
  html?: string, text?: string, cc?: string, bcc?: string,
) {
  const body: any = { account, to: to.split(",").map((s: string) => ({ address: s.trim() })), subject };
  if (html) body.html = html;
  if (text) body.text = text;
  if (cc) body.cc = cc.split(",").map((s: string) => ({ address: s.trim() }));
  if (bcc) body.bcc = bcc.split(",").map((s: string) => ({ address: s.trim() }));
  const res = await api.post("/emails", body, { project });
  await api.post("/observations", {
    observation_type: "preference",
    content: `Agent sent email to ${to} about "${subject}"`,
    importance: 7,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Save a draft email without sending */
export async function emailDraft(
  project: string, account: string, to: string, subject: string, html?: string,
) {
  const body: any = { account, to: to.split(",").map((s: string) => ({ address: s.trim() })), subject };
  if (html) body.html = html;
  const res = await api.post("/emails/draft", body, { project });
  await api.post("/observations", {
    observation_type: "preference",
    content: `Agent drafted email to ${to} about "${subject}"`,
    importance: 5,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List all email folders for an account */
export async function emailFolders(project: string, account: string) {
  const res = await api.get("/emails/folders", { project, account });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List connected email accounts */
export async function emailAccounts(project: string) {
  const res = await api.get("/emails/accounts", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Self-Learning Email Tools ──────────────────────────────────────────────

/** Triage emails — categorize by priority and suggest actions */
export async function emailTriage(project: string, account: string, limit?: number) {
  const res = await api.get("/emails/triage", {
    project, account,
    limit: String(limit ?? 20),
  });
  await api.post("/observations", {
    observation_type: "pattern",
    content: `Agent triaged inbox for account ${account}`,
    importance: 6,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Suggest an email response based on learned user patterns */
export async function emailSuggestResponse(project: string, account: string, uid: number, folder?: string) {
  const res = await api.get(`/emails/suggest/${uid}`, {
    project, account,
    folder: folder ?? "INBOX",
  });
  if (res.data?.matchedSkill) {
    await api.post("/observations", {
      observation_type: "insight",
      content: `Response pattern "${res.data.matchedSkill}" matched email #${uid} (confidence: ${res.data.confidence})`,
      importance: 7,
      source: "agent",
    }, { project });
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Auto-draft a response to an email based on learned patterns or LLM smart-replies */
export async function emailDraftResponse(project: string, account: string, uid: number, folder?: string) {
  const suggest = await api.get(`/emails/suggest/${uid}`, {
    project, account,
    folder: folder ?? "INBOX",
  });
  // New API shape: { suggestions: [...], source: "...", configured: boolean }
  // Old API shape: { data: { body, subject, matchedSkill, ... } } — for backward compat
  const suggestions: Array<{ tone?: string; subject?: string; body?: string }> =
    suggest.data?.suggestions ?? (suggest.data?.body ? [suggest.data] : []);
  const first = suggestions[0];
  if (!first?.body) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No suggestion available" }) }] };
  }
  const recipient = suggest.data?.originalSender
    ? [{ address: suggest.data.originalSender }]
    : [];
  const draft = await api.post("/emails/draft", {
    account,
    to: recipient,
    subject: first.subject ?? "Re:",
    html: first.body,
  }, { project });
  const sourceInfo = suggest.data?.source ?? "unknown";
  await api.post("/observations", {
    observation_type: "preference",
    content: `Agent auto-drafted response to email #${uid} (source: ${sourceInfo})`,
    importance: 7,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ draft: draft.data, suggestion: first, source: sourceInfo }) }] };
}

/** List all learned email response patterns (skills with category 'email') */
export async function emailPatterns(project: string) {
  const res = await api.get("/skills", { project });
  const emailSkills = (res.data || []).filter((s: any) => s.category === "email");
  return { content: [{ type: "text" as const, text: JSON.stringify(emailSkills) }] };
}

/** Start IMAP IDLE watcher for real-time email monitoring */
export async function emailWatchStart(project: string, account: string) {
  const res = await api.post("/emails/watch/start", { account }, { project });
  await api.post("/observations", {
    observation_type: "workflow",
    content: `Agent started IMAP watcher for account ${account}`,
    importance: 5,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Check if the IMAP IDLE watcher is running for an account */
export async function emailWatchStatus(project: string, account: string) {
  const res = await api.get("/emails/watch/status", { project, account });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

// ── Admin / Operations Email Tools ──────────────────────────────────────────

/** Create a new email account connection */
export async function emailAccountCreate(
  project: string, email: string, provider: string, authType: string,
  name?: string, appPassword?: string, imapHost?: string, smtpHost?: string,
  imapPort?: number, smtpPort?: number,
) {
  const body: any = { email, provider, authType };
  if (name) body.name = name;
  if (appPassword) body.appPassword = appPassword;
  if (imapHost) body.imapHost = imapHost;
  if (smtpHost) body.smtpHost = smtpHost;
  if (imapPort) body.imapPort = imapPort;
  if (smtpPort) body.smtpPort = smtpPort;
  const res = await api.post("/emails/accounts", body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete an email account and clear its cached data */
export async function emailAccountDelete(project: string, account: string) {
  const res = await api.del(`/emails/accounts/${account}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.ok ? { deleted: true } : { error: "Deletion failed" }) }] };
}

/** Test IMAP connection for an account */
export async function emailAccountTest(project: string, account: string) {
  const res = await api.post(`/emails/accounts/${account}/test`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get OAuth authorization URL — 🔴 NEVER returns tokens, only the URL */
export async function emailOauthUrl(project: string, provider: string) {
  const res = await api.get("/emails/accounts/oauth/url", { project, provider });
  // 🔴 SAFETY: Only forward the authorization URL, never tokens
  const url = res.data?.url ?? res.data;
  return { content: [{ type: "text" as const, text: JSON.stringify({ url }) }] };
}

/** Exchange OAuth code for tokens — 🔴 NEVER returns tokens, only success/failure */
export async function emailOauthExchange(
  project: string, provider: string, code: string, state: string,
  redirectUri?: string, accountId?: string,
) {
  const body: any = { provider, code, state };
  if (redirectUri) body.redirectUri = redirectUri;
  if (accountId) body.accountId = accountId;
  const res = await api.post("/emails/accounts/oauth", body, { project });
  // 🔴 SAFETY: Only return success/failure, NEVER any credential material
  if (res.ok && res.data?.accountId) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, accountId: res.data.accountId }) }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: res.data?.error ?? "OAuth exchange failed" }) }] };
}

/** Get LLM-generated email summary (cache-first) */
export async function emailSummarize(project: string, account: string, uid: number, folder?: string) {
  const res = await api.get(`/emails/summarize/${uid}`, {
    project, account,
    folder: folder ?? "INBOX",
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** LLM-powered draft review and improvement */
export async function emailReviewDraft(project: string, text: string, subject?: string) {
  const body: any = { text };
  if (subject) body.subject = subject;
  const res = await api.post("/emails/review-draft", body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Move an email to another folder */
export async function emailMove(project: string, account: string, uid: number, fromFolder: string, toFolder: string) {
  const res = await api.patch(`/emails/${uid}/move`, { account, fromFolder, toFolder }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Set flags on an email */
export async function emailSetFlags(project: string, account: string, uid: number, folder: string, flags: string[]) {
  const res = await api.patch(`/emails/${uid}/flags`, { account, folder, flags }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Delete an email (moves to Trash via IMAP) */
export async function emailDelete(project: string, account: string, uid: number, folder?: string) {
  const res = await api.del(`/emails/${uid}`, {
    project, account,
    folder: folder ?? "INBOX",
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.ok ? { deleted: true } : { error: "Deletion failed" }) }] };
}

/** Trigger engine-backed sync hint */
export async function emailSync(project: string, account: string, folder?: string) {
  const body: any = { account };
  if (folder) body.folder = folder;
  const res = await api.post("/emails/sync", body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get per-folder sync status from the engine */
export async function emailSyncStatus(project: string, account: string) {
  const res = await api.get("/emails/sync-status", { project, account });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Stop IMAP IDLE watcher */
export async function emailWatchStop(project: string, account: string) {
  const res = await api.post("/emails/watch/stop", { account }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/**
 * Download an email attachment and write it to a validated path.
 * 🔴 SAFETY: Never returns raw binary content. Always writes to a validated path
 * within /workspace or the user's home directory. Returns file metadata only.
 */
export async function emailAttachmentGet(
  project: string, account: string, uid: number, attachmentId: string,
  folder?: string, outputPath?: string,
) {
  if (!outputPath) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: "outputPath is required — specify a path within /workspace or your home directory" }) }] };
  }

  // 🔴 Validate outputPath before making any network call
  let safePath: string;
  try {
    safePath = validateSafePath(outputPath);
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid outputPath: ${err.message}` }) }] };
  }

  // Ensure the parent directory exists
  await fs.mkdir(path.dirname(safePath), { recursive: true });

  // Build the API URL and perform a raw fetch for binary response
  const apiBase = config.apiUrl.endsWith("/") ? config.apiUrl : config.apiUrl + "/";
  const url = new URL(
    `emails/${uid}/attachments/${attachmentId}`,
    apiBase,
  );
  url.searchParams.set("project", project);
  url.searchParams.set("account", account);
  url.searchParams.set("folder", folder ?? "INBOX");

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Download failed: HTTP ${response.status} — ${errText}` }) }] };
  }

  const mimeType = response.headers.get("content-type") ?? "application/octet-stream";

  // Stream to file — NEVER buffer the full binary in memory
  if (!response.body) {
    // Fallback for responses without a readable body (extremely rare)
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(safePath, buffer);
  } else {
    const fileStream = createWriteStream(safePath);
    await pipeline(response.body, fileStream);
  }

  const stat = await fs.stat(safePath);
  return { content: [{ type: "text" as const, text: JSON.stringify({ savedPath: safePath, mimeType, size: stat.size }) }] };
}
