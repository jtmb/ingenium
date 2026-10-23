import { mkdirSync, realpathSync, lstatSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { visibleContextExport } from "@ingenium/extension/context-upload-codec";
import { getV2SessionInfo, legacySessionInfo, legacySessionMessage, readV2Messages, type OpenCodeV2Client } from "./opencode-v2.js";

type Invoke = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
export class ContextAutoUploader {
  private readonly pending = new Map<string, { again: boolean; promise: Promise<void> }>();

  constructor(private readonly project: string, private readonly worktree: string,
    private readonly client: OpenCodeV2Client, private readonly invoke: Invoke) {}

  sync(session: string): Promise<void> {
    const pending = this.pending.get(session);
    if (pending) {
      pending.again = true;
      return pending.promise;
    }
    const state = { again: false, promise: Promise.resolve() };
    this.pending.set(session, state);
    state.promise = (async () => {
      do {
        state.again = false;
        await this.upload(session).catch(() => undefined);
      } while (state.again);
    })().finally(() => this.pending.delete(session));
    return state.promise;
  }

  private async upload(session: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(session)) return;
    const setting = await this.invoke("setting_get", { project: this.project, key: "context_auto_upload_enabled" });
    if (setting.value !== "true") return;
    let path: string | undefined;
    try {
      const info = await getV2SessionInfo(this.client, session);
      const messages = await readV2Messages(this.client, session);
      const seen = new Set<string>();
      const sourceBytes = Buffer.byteLength(JSON.stringify(messages));
      if (sourceBytes > 64 * 1024 * 1024) throw new Error("CONTEXT_UPLOAD_TOO_LARGE");
      for (const message of messages) {
        if (typeof message.id !== "string" || seen.has(message.id)) throw new Error("CONTEXT_UPLOAD_PAGINATION_FAILED");
        seen.add(message.id);
      }
      const visible = visibleContextExport({
        info: legacySessionInfo(info, session, this.worktree),
        messages: messages.map((message) => legacySessionMessage(message, session)),
      }, session, this.worktree);
      if (!visible.messages.length) return;
      visible.info.contextUploadAutomatic = true;
      const bytes = JSON.stringify(visible);
      if (Buffer.byteLength(bytes) > 64 * 1024 * 1024) throw new Error("CONTEXT_UPLOAD_TOO_LARGE");
      let directory = this.worktree;
      for (const segment of ["", ".ingenium", "context-uploads"]) {
        directory = segment ? join(directory, segment) : directory;
        if (segment) {
          try { mkdirSync(directory, { mode: 0o700 }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        }
        const stat = lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== resolve(directory)
          || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o022)) throw new Error("CONTEXT_UPLOAD_FILE_REJECTED");
      }
      path = join(directory, `automatic-${randomUUID()}.json`);
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
      const result = await this.invoke("context_upload_file", { project: this.project, session, file_path: path });
      if (result.error) throw new Error("CONTEXT_UPLOAD_REJECTED");
    } catch {
      await this.invoke("setting_set", { project: this.project, key: "context_upload_last_sync",
        value: JSON.stringify({ status: "failed", at: new Date().toISOString(), session }) }).catch(() => undefined);
    } finally {
      if (path) { try { unlinkSync(path); } catch { /* Retained files contain only redacted visible text. */ } }
    }
  }
}
