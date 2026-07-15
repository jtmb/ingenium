/**
 * GmailProvider — MailProvider implementation backed by the Gmail REST API.
 *
 * Uses the thin fetch client in gmail-api.ts. Every method calls
 * `getFreshGmailToken()` to ensure the access token is fresh before
 * making API calls, regardless of the `tokens` parameter passed in.
 *
 * Label → Folder Mapping:
 *   INBOX→INBOX  SENT→Sent  SPAM→Spam  TRASH→Trash
 *   STARRED→Starred  IMPORTANT→Important
 *   Custom labels (type='user') → label name directly
 *   Skipped: DRAFT, CATEGORY_*, CHAT, unknown system labels
 */

import type { MailProvider, CachedEmailWrite } from "./mail-provider.js";
import type { EmailAccount, OAuthToken, EmailFolder, EmailAttachment } from "../types.js";
import type { SendOptions } from "../smtp.js";
import {
  listLabels as apiListLabels,
  listMessages as apiListMessages,
  batchGetMessages,
  getMessage,
  getHistory,
  getAttachment as apiGetAttachment,
  sendMessage as apiSendMessage,
  modifyMessage as apiModifyMessage,
  getProfile,
} from "./gmail-api.js";
import { getFreshGmailToken } from "../oauth.js";

// ── Label ↔ Folder mapping ──────────────────────────────────────────────────

/** System label IDs that map to folder names. DRAFT is excluded (skip rule). */
const SYSTEM_LABEL_MAP: Record<string, string> = {
  INBOX: "INBOX",
  SENT: "Sent",
  SPAM: "Spam",
  TRASH: "Trash",
  STARRED: "Starred",
  IMPORTANT: "Important",
};

/** Label IDs to skip entirely. */
const SKIP_LABEL_IDS = new Set(["CHAT", "DRAFT"]);

// ── Internal helpers ────────────────────────────────────────────────────────

interface LabelInfo {
  id: string;
  name: string;
  /** Mapped folder name (same as name for custom labels). */
  folder: string;
}

/**
 * Fetch all labels, map to folders, and return a lookup table.
 * Cached per token lifetime; caller should invalidate when needed.
 */
async function getLabelMap(token: string): Promise<Map<string, LabelInfo>> {
  const labels = await apiListLabels(token);
  const map = new Map<string, LabelInfo>();

  for (const label of labels) {
    // Skip excluded label IDs
    if (SKIP_LABEL_IDS.has(label.id)) continue;
    // Skip CATEGORY_* system labels
    if (label.id.startsWith("CATEGORY_")) continue;

    if (label.type === "system") {
      const mapped = SYSTEM_LABEL_MAP[label.id];
      if (mapped) {
        map.set(label.id, { id: label.id, name: label.name, folder: mapped });
      }
      // Unknown system labels are skipped
    } else {
      // Custom/user labels — use the label name as the folder name
      map.set(label.id, { id: label.id, name: label.name, folder: label.name });
    }
  }

  return map;
}

/** Find a label ID for a given folder name. Returns undefined if not found. */
async function findLabelId(token: string, folder: string): Promise<string | undefined> {
  const labelMap = await getLabelMap(token);
  // Walk the map — for system labels (INBOX, Sent, etc.), the folder name is mapped.
  // For custom labels, the folder name equals the label name.
  for (const info of labelMap.values()) {
    if (info.folder === folder) return info.id;
  }
  return undefined;
}

/** Find label IDs for multiple folder names. */
async function findLabelIds(
  token: string,
  folders: string[],
): Promise<string[]> {
  const labelMap = await getLabelMap(token);
  const ids: string[] = [];
  for (const info of labelMap.values()) {
    if (folders.includes(info.folder)) {
      ids.push(info.id);
    }
  }
  return ids;
}

/**
 * Map a raw Gmail metadata message to a CachedEmailWrite.
 * Extracts subject, from, date, snippet, flags, and attachment detection
 * from the standard Gmail message metadata format.
 */
function mapMetadataToCachedEmail(
  msg: any,
  folder: string,
): CachedEmailWrite | null {
  if (!msg.id) return null;

  const headers = msg.payload?.headers as Array<{ name: string; value: string }> | undefined;
  const getHeader = (name: string): string | null => {
    const h = headers?.find(
      (h: { name: string; value: string }) => h.name.toLowerCase() === name.toLowerCase(),
    );
    return h?.value ?? null;
  };

  const subject = getHeader("Subject");
  const fromRaw = getHeader("From");
  const date = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : null;

  // Parse From: "Name" <email> or just email
  let fromName: string | null = null;
  let fromAddr: string | null = null;
  if (fromRaw) {
    const match = fromRaw.match(/^(?:"?([^"]*)"?\s*)?<?([^>]+)>?$/);
    if (match) {
      fromName = (match[1]?.trim() || null) ?? null;
      fromAddr = (match[2]?.trim() || null) ?? null;
    } else {
      fromAddr = fromRaw.trim();
    }
  }

  // Snippet
  const snippet = msg.snippet ?? null;

  // Flags from labelIds
  const labelIds: string[] = msg.labelIds ?? [];
  const flags: string[] = [];
  if (!labelIds.includes("UNREAD")) flags.push("\\Seen");
  if (labelIds.includes("STARRED")) flags.push("\\Flagged");

  // Attachment detection — only multipart/mixed carries real attachments.
  // multipart/related (inline images) and multipart/alternative (text+HTML) are false positives.
  const mimeType = msg.payload?.mimeType ?? "";
  const hasAttachments = mimeType.startsWith("multipart/mixed");

  // envelopeJson from headers
  let envelopeJson: string | null = null;
  try {
    envelopeJson = JSON.stringify({
      to: getHeader("To"),
      cc: getHeader("Cc"),
      bcc: getHeader("Bcc"),
      messageId: getHeader("Message-ID"),
      inReplyTo: getHeader("In-Reply-To"),
      references: getHeader("References"),
    });
  } catch {
    // Non-fatal
  }

  return {
    id: msg.id,
    folder,
    subject,
    fromName,
    fromAddr,
    date,
    snippet,
    flags,
    hasAttachments,
    envelopeJson,
  };
}

/**
 * Walk Gmail message parts tree recursively to extract text, HTML, and attachment metadata.
 */
function walkParts(
  parts: any[],
): { text?: string; html?: string; attachments: Array<{ partId: string; attachmentId?: string; filename: string; mimeType: string; size: number; body: any }> } {
  let text: string | undefined;
  let html: string | undefined;
  const attachments: Array<{ partId: string; attachmentId?: string; filename: string; mimeType: string; size: number; body: any }> = [];

  function walk(partList: any[]): void {
    for (const part of partList) {
      // Recurse into multipart containers
      if (part.parts && Array.isArray(part.parts)) {
        walk(part.parts);
      }

      const mimeType = part.mimeType ?? "";

      // Text part
      if (mimeType === "text/plain" && !text && part.body?.data) {
        text = Buffer.from(part.body.data, "base64url").toString("utf-8");
      }

      // HTML part (prefer multipart/alternative's HTML)
      if (mimeType === "text/html" && !html && part.body?.data) {
        html = Buffer.from(part.body.data, "base64url").toString("utf-8");
      }

      // Attachment part
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          partId: part.partId ?? part.body.attachmentId,
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType ?? "application/octet-stream",
          size: Number(part.body.size) || 0,
          body: part.body,
        });
      }
    }
  }

  if (parts) walk(parts);
  return { text, html, attachments };
}

// ── GmailProvider ───────────────────────────────────────────────────────────

export const GmailProvider: MailProvider = {
  // ── listFolders ─────────────────────────────────────────────────────────
  async listFolders(account: EmailAccount, _tokens: OAuthToken): Promise<EmailFolder[]> {
    const token = await getFreshGmailToken(account.id);
    const labelMap = await getLabelMap(token);

    const folders: EmailFolder[] = [];
    for (const info of labelMap.values()) {
      folders.push({
        name: info.folder,
        path: info.folder, // Gmail labels are flat — no hierarchy path
        delimiter: "/",
        flags: [],
        totalMessages: 0,
        unreadMessages: 0,
      });
    }

    return folders;
  },

  // ── listMessages ────────────────────────────────────────────────────────
  async listMessages(
    account: EmailAccount,
    _tokens: OAuthToken,
    folder: string,
    window: number,
  ): Promise<CachedEmailWrite[]> {
    const token = await getFreshGmailToken(account.id);

    // Resolve folder name → label ID
    const labelId = await findLabelId(token, folder);
    if (!labelId) {
      console.warn(`GmailProvider: no label found for folder "${folder}" on account ${account.email}`);
      return [];
    }

    // Get message IDs for this label
    const result = await apiListMessages(token, labelId, window);
    if (!result.messages || result.messages.length === 0) {
      return [];
    }

    const ids = result.messages.map(m => m.id).filter(Boolean) as string[];

    // Batch-get metadata
    const messages = await batchGetMessages(token, ids, "metadata");

    // Map to CachedEmailWrite
    const cached: CachedEmailWrite[] = [];
    for (const msg of messages) {
      const mapped = mapMetadataToCachedEmail(msg, folder);
      if (mapped) cached.push(mapped);
    }

    return cached;
  },

  // ── changesSince ────────────────────────────────────────────────────────
  async changesSince(
    account: EmailAccount,
    _tokens: OAuthToken,
    cursor: string | null,
  ): Promise<{
    upserts: CachedEmailWrite[];
    deletes: { folder: string; id: string }[];
    newCursor: string;
    fullResyncRequired?: boolean;
  }> {
    const token = await getFreshGmailToken(account.id);

    // No cursor → full resync required, but fetch current historyId so
    // the next delta poll can work incrementally instead of failing again.
    if (!cursor) {
      try {
        const profile = await getProfile(token);
        return { upserts: [], deletes: [], newCursor: profile.historyId, fullResyncRequired: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`GmailProvider: failed to get profile historyId for ${account.email}: ${msg}`);
        return { upserts: [], deletes: [], newCursor: "", fullResyncRequired: true };
      }
    }

    try {
      const history = await getHistory(token, cursor);

      const upserts: CachedEmailWrite[] = [];
      const deletes: Array<{ folder: string; id: string }> = [];
      const processedMessageIds = new Set<string>();

      // Build label → folder lookup once
      const labelMap = await getLabelMap(token);

      for (const entry of history.history ?? []) {
        // Messages added
        for (const added of entry.messagesAdded ?? []) {
          if (processedMessageIds.has(added.message?.id)) continue;
          processedMessageIds.add(added.message.id);

          // Get metadata for the full message
          try {
            const msg = await getMessage(token, added.message.id, "metadata");
            // Infer folder from labelIds
            const msgLabelIds: string[] = msg.labelIds ?? [];
            let folder = "INBOX"; // default
            for (const lid of msgLabelIds) {
              const info = labelMap.get(lid);
              if (info) { folder = info.folder; break; }
            }
            const cached = mapMetadataToCachedEmail(msg, folder);
            if (cached) upserts.push(cached);
          } catch (err: unknown) {
            const emsg = err instanceof Error ? err.message : String(err);
            console.warn(`GmailProvider: failed to get message ${added.message.id} during changesSince: ${emsg}`);
          }
        }

        // Messages deleted
        for (const deleted of entry.messagesDeleted ?? []) {
          if (processedMessageIds.has(deleted.message?.id)) continue;
          processedMessageIds.add(deleted.message.id);

          deletes.push({
            folder: "", // Unknown folder for deletes — caller handles
            id: deleted.message.id,
          });
        }

        // Labels added/removed — treat as upserts (re-fetch metadata)
        const labelChangeIds = new Set<string>();
        for (const la of entry.labelsAdded ?? []) {
          if (la.message?.id) labelChangeIds.add(la.message.id);
        }
        for (const lr of entry.labelsRemoved ?? []) {
          if (lr.message?.id) labelChangeIds.add(lr.message.id);
        }
        for (const mid of labelChangeIds) {
          if (processedMessageIds.has(mid)) continue;
          processedMessageIds.add(mid);

          try {
            const msg = await getMessage(token, mid, "metadata");
            const msgLabelIds: string[] = msg.labelIds ?? [];
            let folder = "INBOX";
            for (const lid of msgLabelIds) {
              const info = labelMap.get(lid);
              if (info) { folder = info.folder; break; }
            }
            const cached = mapMetadataToCachedEmail(msg, folder);
            if (cached) upserts.push(cached);
          } catch (err: unknown) {
            const emsg = err instanceof Error ? err.message : String(err);
            console.warn(`GmailProvider: failed to get label-changed message ${mid}: ${emsg}`);
          }
        }
      }

      return {
        upserts,
        deletes,
        newCursor: history.historyId,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 from Gmail means historyId expired
      if (msg.includes("404")) {
        console.warn(`GmailProvider: historyId ${cursor} expired for ${account.email}, full resync required`);
        return { upserts: [], deletes: [], newCursor: "", fullResyncRequired: true };
      }
      throw err;
    }
  },

  // ── getBody ─────────────────────────────────────────────────────────────
  async getBody(
    account: EmailAccount,
    _tokens: OAuthToken,
    id: string,
  ): Promise<{ html?: string; text?: string; attachments: EmailAttachment[] }> {
    const token = await getFreshGmailToken(account.id);

    const msg = await getMessage(token, id, "full");
    const parts = msg.payload?.parts ?? (msg.payload ? [msg.payload] : []);
    const result = walkParts(parts);

    const emailAttachments: EmailAttachment[] = result.attachments.map(a => ({
      partId: a.partId,
      attachmentId: a.attachmentId,
      filename: a.filename,
      size: a.size,
      mimeType: a.mimeType,
    }));

    return {
      html: result.html,
      text: result.text,
      attachments: emailAttachments,
    };
  },

  // ── getAttachment ───────────────────────────────────────────────────────
  async getAttachment(
    account: EmailAccount,
    _tokens: OAuthToken,
    id: string,
    attachmentId: string,
  ): Promise<{ data: Buffer; mimeType: string; filename: string }> {
    const token = await getFreshGmailToken(account.id);

    // Re-fetch the full message and walk its parts to find the matching
    // attachment by attachmentId OR partId (handles both old and new caches).
    const msg = await getMessage(token, id, "full");
    const parts = msg.payload?.parts ?? (msg.payload ? [msg.payload] : []);
    const result = walkParts(parts);
    const found = result.attachments.find(
      a => a.attachmentId === attachmentId || a.partId === attachmentId,
    );

    // Use the real body.attachmentId if found, otherwise fall back to the
    // parameter as a last resort (handles edge cases and legacy data).
    let att: { data: string; size: number };
    if (found?.body?.attachmentId) {
      att = await apiGetAttachment(token, id, found.body.attachmentId);
    } else {
      att = await apiGetAttachment(token, id, attachmentId);
    }

    // Decode base64url data to Buffer
    const data = Buffer.from(att.data, "base64url");

    // Get mimeType + filename from found attachment metadata.
    // 🔴 L29: NEVER use the opaque Gmail attachmentId token as a filename —
    // it produces garbage like "ANGjdJ_Jt0bbNX..." in the browser download.
    const mimeType = found?.mimeType ?? "application/octet-stream";
    const filename = found?.filename ?? `attachment-${attachmentId.slice(0, 8)}`;

    return { data, mimeType, filename };
  },

  // ── send ────────────────────────────────────────────────────────────────
  async send(
    account: EmailAccount,
    _tokens: OAuthToken,
    options: SendOptions,
  ): Promise<void> {
    const token = await getFreshGmailToken(account.id);

    const rfc822 = buildRfc822(account, options);
    const raw = Buffer.from(rfc822, "utf-8").toString("base64url");

    await apiSendMessage(token, raw);
  },

  // ── modifyFolders ──────────────────────────────────────────────────────
  async modifyFolders(
    account: EmailAccount,
    _tokens: OAuthToken,
    id: string,
    addFolder: string | null,
    removeFolder: string | null,
  ): Promise<void> {
    const token = await getFreshGmailToken(account.id);

    let addLabelIds: string[] | undefined;
    let removeLabelIds: string[] | undefined;

    if (addFolder) {
      const ids = await findLabelIds(token, [addFolder]);
      if (ids.length > 0) addLabelIds = ids;
    }

    if (removeFolder) {
      const ids = await findLabelIds(token, [removeFolder]);
      if (ids.length > 0) removeLabelIds = ids;
    }

    if (!addLabelIds?.length && !removeLabelIds?.length) {
      return; // Nothing to do
    }

    await apiModifyMessage(token, id, addLabelIds, removeLabelIds);
  },
};

// ── RFC822 Builder ──────────────────────────────────────────────────────────

/**
 * Build a minimal RFC822 message from send options.
 * Encoded as UTF-8 with base64url-ready output.
 */
function buildRfc822(account: EmailAccount, options: SendOptions): string {
  const lines: string[] = [];

  // Headers
  lines.push(`From: "${account.name}" <${account.email}>`);
  lines.push(`To: ${formatAddressList(options.to)}`);
  if (options.cc?.length) lines.push(`Cc: ${formatAddressList(options.cc)}`);
  if (options.bcc?.length) lines.push(`Bcc: ${formatAddressList(options.bcc)}`);
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(options.subject, "utf-8").toString("base64")}?=`);
  if (options.inReplyTo) lines.push(`In-Reply-To: ${options.inReplyTo}`);
  if (options.references) lines.push(`References: ${options.references}`);
  lines.push("MIME-Version: 1.0");

  // Body
  if (options.html) {
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    // Fold base64 content into 78-char lines for RFC compliance
    const encoded = Buffer.from(options.html, "utf-8").toString("base64");
    for (let i = 0; i < encoded.length; i += 78) {
      lines.push(encoded.slice(i, i + 78));
    }
  } else if (options.text) {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push("");
    lines.push(options.text);
  }

  return lines.join("\r\n") + "\r\n";
}

function formatAddressList(list: { name?: string; address: string }[]): string {
  return list.map(a => a.name ? `"${a.name}" <${a.address}>` : a.address).join(", ");
}
