import { randomUUID } from "node:crypto";
import type { EmailAccount, OAuthToken } from "./types.js";
import { GmailProvider, type CachedEmailWrite } from "./providers/gmail.js";
import { connectAccount, disconnectAccount, listEmails, listFolders } from "./imap.js";
import { parseRawEmail } from "./parser.js";
import { ProviderOperationError } from "./provider-errors.js";

type Auth = { password?: string; tokens?: OAuthToken };
type Delta = Awaited<ReturnType<typeof GmailProvider.changesSince>>;
type Body = Awaited<ReturnType<typeof GmailProvider.getBody>>;
export interface SyncProvider {
  kind: "gmail" | "imap";
  listFolders(account: EmailAccount, auth: Auth): ReturnType<typeof GmailProvider.listFolders>;
  listMessages(account: EmailAccount, auth: Auth, folder: string, window: number): Promise<CachedEmailWrite[]>;
  getBody(account: EmailAccount, auth: Auth, uid: string, folder: string): Promise<Body>;
  changesSince(account: EmailAccount, auth: Auth, cursor: string | null): Promise<Delta>;
  folderSnapshot?(folder: string): { uidValidity: number; lastUid: string } | undefined;
  close(): Promise<void>;
}
function oauth(auth: Auth): OAuthToken {
  if (!auth.tokens) throw new ProviderOperationError("AUTH_REQUIRED", "api", false);
  return auth.tokens;
}
/** Each IMAP worker owns an isolated connection, including across replacement. */
export function createSyncProvider(account: EmailAccount): SyncProvider {
  if (account.provider === "gmail" && account.authType === "oauth2") return {
    kind: "gmail",
    listFolders: (a, auth) => GmailProvider.listFolders(a, oauth(auth)),
    listMessages: (a, auth, folder, window) => GmailProvider.listMessages(a, oauth(auth), folder, window),
    getBody: (a, auth, uid) => GmailProvider.getBody(a, oauth(auth), uid),
    changesSince: (a, auth, cursor) => GmailProvider.changesSince(a, oauth(auth), cursor),
    close: async () => {},
  };
  const connectionId = "mail-sync:" + account.id + ":" + randomUUID();
  const snapshots = new Map<string, { uidValidity: number; lastUid: string }>();
  const connect = (a: EmailAccount, auth: Auth) => connectAccount({ ...a, id: connectionId }, auth);
  return {
    kind: "imap",
    async listFolders(a, auth) { await connect(a, auth); return listFolders(connectionId); },
    async listMessages(a, auth, folder, window) {
      const client = await connect(a, auth);
      const lock = await client.getMailboxLock(folder);
      try {
        const result = await listEmails(connectionId, folder, 1, window, undefined, window);
        const mailbox = client.mailbox;
        if (!mailbox) throw new ProviderOperationError("PROVIDER_ERROR", "imap", true);
        snapshots.set(folder, { uidValidity: Number(mailbox.uidValidity), lastUid: String(Math.max(0, ...result.messages.map(m => Number(m.uid)))) });
        return result.messages.map(m => ({
          id: m.uid, folder, subject: m.subject, fromName: m.from[0]?.name ?? null,
          fromAddr: m.from[0]?.address ?? null, date: m.date, snippet: m.body.text?.slice(0, 200) ?? null,
          flags: m.flags, hasAttachments: m.attachments.length > 0,
          envelopeJson: JSON.stringify({ to: m.to, cc: m.cc, messageId: m.messageId, inReplyTo: m.inReplyTo, references: m.references }),
        }));
      } finally { lock.release(); }
    },
    async getBody(a, auth, uid, folder) {
      const client = await connect(a, auth);
      const lock = await client.getMailboxLock(folder);
      try {
        const expected = snapshots.get(folder);
        if (!expected || !client.mailbox || Number(client.mailbox.uidValidity) !== expected.uidValidity) {
          throw new ProviderOperationError("PROVIDER_REJECTED", "imap", true);
        }
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message || !message.source) throw new ProviderOperationError("PROVIDER_REJECTED", "imap", false);
        const parsed = await parseRawEmail(message.source.toString("utf8"));
        return { ...parsed.body, attachments: parsed.attachments };
      } finally { lock.release(); }
    },
    changesSince: async () => ({ upserts: [], deletes: [], newCursor: "" }),
    folderSnapshot: folder => snapshots.get(folder),
    close: () => disconnectAccount(connectionId),
  };
}
