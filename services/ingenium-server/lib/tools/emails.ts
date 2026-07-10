/**
 * MCP tool handlers for email operations.
 * Provides 13 tools: 7 basic email tools + 6 self-learning email tools.
 * Logs observations to the self-learning pipeline as a side effect.
 */
import { api } from "../client.js";

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

/** Auto-draft a response to an email based on learned patterns */
export async function emailDraftResponse(project: string, account: string, uid: number, folder?: string) {
  const suggest = await api.get(`/emails/suggest/${uid}`, {
    project, account,
    folder: folder ?? "INBOX",
  });
  if (!suggest.data?.body) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No suggestion available" }) }] };
  }
  const draft = await api.post("/emails/draft", {
    account,
    to: (suggest.data.originalSender ? [{ address: suggest.data.originalSender }] : []),
    subject: suggest.data.subject ?? "Re:",
    html: suggest.data.body,
  }, { project });
  await api.post("/observations", {
    observation_type: "preference",
    content: `Agent auto-drafted response to email #${uid} based on pattern "${suggest.data.matchedSkill ?? "unknown"}"`,
    importance: 7,
    source: "agent",
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ draft: draft.data, suggestion: suggest.data }) }] };
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
