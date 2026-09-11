import { mkdirSync, realpathSync, lstatSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { visibleContextExport } from "@ingenium/extension/context-upload-codec";

type Invoke = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Client = { session?: {
  get?: (args: unknown) => Promise<unknown>;
  messages?: (args: unknown) => Promise<unknown>;
} };

function data(response: unknown): unknown {
  return response && typeof response === "object" && "data" in response ? response.data : undefined;
}

export class ContextAutoUploader {
  private readonly pending = new Map<string, { again: boolean; promise: Promise<void> }>();

  constructor(private readonly project: string, private readonly worktree: string,
    private readonly client: unknown, private readonly invoke: Invoke) {}

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
      const args = { path: { id: session }, query: { directory: this.worktree } };
      const client = this.client as Client | undefined;
      const info = data(await client?.session?.get?.(args));
      const pages: unknown[][] = [];
      const seen = new Set<string>();
      let before: string | undefined;
      let sourceBytes = 0;
      for (;;) {
        const page = data(await client?.session?.messages?.({ ...args, query: { ...args.query, limit: 100, ...(before ? { before } : {}) } }));
        if (!Array.isArray(page)) throw new Error("CONTEXT_UPLOAD_UNAVAILABLE");
        sourceBytes += Buffer.byteLength(JSON.stringify(page));
        if (sourceBytes > 64 * 1024 * 1024) throw new Error("CONTEXT_UPLOAD_TOO_LARGE");
        for (const message of page) {
          const id = message?.info?.id;
          if (typeof id !== "string" || seen.has(id)) throw new Error("CONTEXT_UPLOAD_PAGINATION_FAILED");
          seen.add(id);
        }
        pages.push(page);
        if (page.length < 100) break;
        before = page[0]?.info?.id;
      }
      const visible = visibleContextExport({ info, messages: pages.reverse().flat() }, session, this.worktree);
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
