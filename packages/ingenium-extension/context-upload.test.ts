import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ContextAutoUploader } from "./context-upload.js";
import { redactContextText, visibleContextExport } from "./context-upload-codec.mjs";
import type { OpenCodeV2Client } from "./opencode-v2.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function message(id: string, role = "user", complete = true, text = "visible") {
  return { info: { id, sessionID: "ses_exact", role, ...(complete ? { time: { completed: 1 } } : {}) },
    parts: [{ type: "text", text }, { type: "tool", text: "excluded" }, { type: "reasoning", text: "excluded" }] };
}
function v2Message(id: string, text = "visible") {
  return { id, type: "user" as const, time: { created: 1 }, text };
}
function v2Client(worktree: string, messages: ReturnType<typeof v2Message>[]) {
  const session = {
    get: vi.fn(async () => ({ data: { id: "ses_exact", location: { directory: worktree } } })),
    messages: vi.fn(async () => ({ data: { data: messages, cursor: {} } })),
  };
  return { client: { session } as unknown as OpenCodeV2Client, session };
}

describe("Context upload boundary", () => {
  it("redacts credential values and webhook URLs before producing any export", () => {
    const value = randomUUID();
    const text = `token=${value}\nAuthorization: Bearer ${value}\nhttps://example.test/webhook/${value}\napi_key="${value}"\npassword: words ${value}\nAWS_SECRET_ACCESS_KEY=${value}\npostgres://user:${value}@example.test/db`;
    const redacted = redactContextText(text);
    expect(redacted.includes(value)).toBe(false);
    expect(redactContextText(redacted)).toBe(redacted);
    const exported = visibleContextExport({ info: { id: "ses_exact", directory: "/work" }, messages: [message("m1", "user", true, text)] }, "ses_exact", "/work");
    expect(JSON.stringify(exported).includes(value)).toBe(false);
    expect(JSON.stringify(exported)).not.toContain("excluded");
  });

  it("redacts passphrase labels, including escaped and unfinished quotes, without losing useful surrounding text", () => {
    const value = randomUUID();
    const labels = ["passphrase", "Pass Phrase", "pass_phrase", "pass-phrase", "SSH_KEY_PASSPHRASE", "keyPassphrase", "**Passphrase**", "API key"];
    const text = labels.map((label) => `${label}: ${JSON.stringify(`two words "${value}"`)}; keep useful text`).join("\n");
    const redacted = redactContextText(text);
    expect(redacted).not.toContain(value);
    expect(redacted.match(/keep useful text/g)).toHaveLength(labels.length);
    expect(redactContextText(redacted)).toBe(redacted);
    expect(redactContextText(`passphrase is \`${value}\`; keep this`)).toBe("passphrase is `[REDACTED]`; keep this");
    expect(redactContextText(`"passphrase":"${value}","status":"healthy"`)).toBe('"passphrase": "[REDACTED]","status":"healthy"');
    expect(redactContextText(`passphrase: "${value}\n${value}\\`)).toBe('passphrase: "[REDACTED]"');
    expect(redactContextText(`**Passphrase:** "${value}"; keep this`)).toBe('**Passphrase:** "[REDACTED]"; keep this');
    expect(redactContextText(`passphrase:\n\`\`\`\n${value}\n\`\`\`\nkeep this`)).toBe("passphrase: ```[REDACTED]```\nkeep this");
    expect(redactContextText(`passphrase: two words ${value}\nkeep this`)).toBe("passphrase: [REDACTED]\nkeep this");
    expect(redactContextText(`passphrase: [REDACTED]${value}`)).toBe("passphrase: [REDACTED]");
  });

  it("redacts fragment, encoded, nested and opaque URL capabilities and tokens but preserves ordinary links and prose", () => {
    const value = randomUUID().replaceAll("-", "");
    const shortValue = value.slice(0, 12);
    const jwt = `eyJ${value}.${value}.${value}`;
    const urls = [
      `https://example.test/#access_token=${shortValue}`,
      `https://example.test/?passphrase=${shortValue}`,
      `https://example.test/?%70assphrase=${shortValue}`,
      `https://example.test/%2570assphrase/${shortValue}`,
      `https://example.test/passphrase/${shortValue}`,
      `https://example.test/my-webhook/${shortValue}`,
      `https://example.test/?redirect=${encodeURIComponent(`https://other.test/?token=${shortValue}`)}`,
      `https://example.test/download/${value}`,
      `https://example.test/?q=${value}`,
      `https://example.test/#${jwt}`,
      `https://user:${value}@example.test/path`,
    ];
    for (const url of urls) {
      const redacted = redactContextText(`before ${url} after`);
      expect(redacted).toBe("before [REDACTED] after");
      expect(redactContextText(redacted)).toBe(redacted);
    }
    const tokens = ["sk-", "ghp_", "github_pat_", "xoxb-", "glpat-", "npm_"].map((prefix) => `${prefix}${value}`);
    expect(redactContextText([...tokens, jwt].join("\n"))).toBe(Array(tokens.length + 1).fill("[REDACTED]").join("\n"));
    const useful = `Keep https://example.test/docs?view=compact#install and the public build id ${value}.`;
    expect(redactContextText(useful)).toBe(useful);
  });

  it("binds the session/worktree and stops before an unfinished assistant, including finish-only messages", () => {
    const input = { info: { id: "ses_exact", directory: "/work" }, messages: [message("m1"), message("m2", "assistant", false), message("m3")] };
    Object.assign(input.messages[1]!.info, { finish: "stop" });
    expect(visibleContextExport(input, "ses_exact", "/work").messages).toHaveLength(1);
    expect(() => visibleContextExport(input, "other", "/work")).toThrow("CONTEXT_SESSION_MISMATCH");
    expect(() => visibleContextExport(input, "ses_exact", "/other")).toThrow("CONTEXT_SESSION_MISMATCH");
    input.messages[0]!.info.sessionID = "other";
    expect(() => visibleContextExport(input, "ses_exact", "/work")).toThrow("CONTEXT_SESSION_MISMATCH");
  });

  it("does not let excluded terminal errors or hidden messages block later completed text", () => {
    const failed = message("m1", "assistant", false);
    Object.assign(failed.info, { error: { name: "MessageAbortedError" } });
    const synthetic = message("m2", "assistant", false);
    Object.assign(synthetic.info, { synthetic: true });
    const exported = visibleContextExport({ info: { id: "ses_exact", directory: "/work" },
      messages: [failed, synthetic, message("m3", "assistant")] }, "ses_exact", "/work");
    expect(exported.messages.map((entry) => entry.info.id)).toEqual(["m3"]);
  });

  it("is default-off, binds every call and queues one follow-up capture for overlapping idle events", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "context-auto-")); directories.push(worktree);
    let enabled = false;
    let appended = false;
    const captured: number[] = [];
    const value = randomUUID();
    const fixture = v2Client(worktree, [v2Message("m1", `token=${value}`)]);
    fixture.session.messages.mockImplementation(async () => ({
      data: { data: [v2Message("m1", `token=${value}`), ...(appended ? [v2Message("m2")] : [])], cursor: {} },
    }));
    const client = fixture.client;
    const invoke = vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(args.project).toBe("exact-project");
      if (name === "setting_get") return { value: enabled ? "true" : undefined };
      if (name === "context_upload_file") {
        const content = readFileSync(args.file_path as string, "utf8");
        captured.push(JSON.parse(content).messages.length);
        appended = true;
        expect(content.includes(value)).toBe(false);
        expect(JSON.parse(content).info).toMatchObject({ id: "ses_exact", directory: worktree, contextUploadAutomatic: true });
      }
      return {};
    });
    const uploader = new ContextAutoUploader("exact-project", worktree, client, invoke);
    await uploader.sync("ses_exact");
    expect(fixture.session.get).not.toHaveBeenCalled();
    enabled = true;
    await Promise.all([uploader.sync("ses_exact"), uploader.sync("ses_exact"), uploader.sync("ses_exact")]);
    expect(invoke.mock.calls.filter(([name]) => name === "context_upload_file")).toHaveLength(2);
    expect(captured).toEqual([1, 2]);
    expect(readdirSync(join(worktree, ".ingenium/context-uploads"))).toEqual([]);
    await new ContextAutoUploader("exact-project", worktree, client, invoke).sync("ses_exact");
    expect(invoke.mock.calls.filter(([name]) => name === "context_upload_file")).toHaveLength(3);
    enabled = false;
    await uploader.sync("ses_exact");
    expect(invoke.mock.calls.filter(([name]) => name === "context_upload_file")).toHaveLength(3);
  });

  it("reads every history page before uploading and refuses a cursor that does not advance", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "context-pages-")); directories.push(worktree);
    const latest = Array.from({ length: 100 }, (_, index) => v2Message(`m${index}`));
    const messages = vi.fn(async (args: { cursor?: string }) => ({
      data: { data: args.cursor ? [v2Message("m100")] : latest, cursor: args.cursor ? {} : { next: "page-2" } },
    }));
    const session = { get: async () => ({ data: { id: "ses_exact", location: { directory: worktree } } }), messages };
    const client = { session } as unknown as OpenCodeV2Client;
    const invoke = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "setting_get") return { value: "true" };
      if (name === "context_upload_file") {
        const exported = JSON.parse(readFileSync(args.file_path as string, "utf8"));
        expect(exported.messages).toHaveLength(101);
        expect(exported.messages[0].info.id).toBe("m0");
        expect(exported.messages.at(-1).info.id).toBe("m100");
      }
      return {};
    });
    await new ContextAutoUploader("exact-project", worktree, client, invoke).sync("ses_exact");
    expect(messages).toHaveBeenLastCalledWith({ sessionID: "ses_exact", limit: 100, cursor: "page-2" });
    invoke.mockClear();
    messages.mockImplementation(async () => ({ data: { data: latest, cursor: { next: "same-page" } } }));
    await new ContextAutoUploader("exact-project", worktree, client, invoke).sync("ses_exact");
    expect(invoke.mock.calls.some(([name]) => name === "context_upload_file")).toBe(false);
    expect(invoke.mock.calls.some(([name, args]) => name === "setting_set" && JSON.parse(args.value as string).status === "failed")).toBe(true);
  });
});
