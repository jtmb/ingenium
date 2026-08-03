import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: mockApi }));

const backups = await import("../lib/tools/backups.js");
const PROJECT = "global-default";
const PLAN_ID = "00000000-0000-4000-8000-000000000001";
const BACKUP_ID = "00000000-0000-4000-8000-000000000002";
const TOKEN = "A".repeat(43);

function text(result: { content: [{ text: string }] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("RESTORE-100 MCP backup adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ ok: true, status: 200, data: { id: PLAN_ID, state: "previewed" } });
    mockApi.post.mockResolvedValue({ ok: true, status: 200, data: { id: PLAN_ID, state: "ready_for_executor" } });
  });

  it("forwards preview, confirmation, distinct execution authorization/queue, status, and audit contracts", async () => {
    await backups.backupRestorePreview(PROJECT, BACKUP_ID, true, "preview-key");
    expect(mockApi.post).toHaveBeenLastCalledWith("/backups/restore/preview", {
      backupId: BACKUP_ID, dryRun: true, idempotencyKey: "preview-key",
    }, { project: PROJECT });

    await backups.backupRestoreAuthorize(PROJECT, PLAN_ID, 4);
    expect(mockApi.post).toHaveBeenLastCalledWith(`/backups/restore/${PLAN_ID}/authorize`, {
      expectedRevision: 4,
    }, { project: PROJECT });

    await backups.backupRestoreStart(PROJECT, PLAN_ID, 5, TOKEN, "confirm-key");
    expect(mockApi.post).toHaveBeenLastCalledWith(`/backups/restore/${PLAN_ID}/confirm`, {
      expectedRevision: 5, confirmationToken: TOKEN, idempotencyKey: "confirm-key",
    }, { project: PROJECT });

    await backups.backupRestoreExecutionAuthorize(PROJECT, PLAN_ID, 3);
    expect(mockApi.post).toHaveBeenLastCalledWith(`/backups/restore/${PLAN_ID}/execution/authorize`, {
      expectedRevision: 3,
    }, { project: PROJECT });
    await backups.backupRestoreExecute(PROJECT, PLAN_ID, 4, TOKEN, "execute-key");
    expect(mockApi.post).toHaveBeenLastCalledWith(`/backups/restore/${PLAN_ID}/execute`, {
      expectedRevision: 4, executionToken: TOKEN, idempotencyKey: "execute-key",
    }, { project: PROJECT });

    await backups.backupRestoreStatus(PROJECT, PLAN_ID);
    expect(mockApi.get).toHaveBeenLastCalledWith(`/backups/restore/${PLAN_ID}`, { project: PROJECT });
    await backups.backupRestoreAuditList(PROJECT, PLAN_ID, 20);
    expect(mockApi.get).toHaveBeenLastCalledWith(`/backups/restore/${PLAN_ID}/audit`, { project: PROJECT, limit: "20" });
  });

  it("returns the raw confirmation token only from the authorization response and never synthesizes a token", async () => {
    mockApi.post.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { plan: { id: PLAN_ID, state: "authorized" }, confirmationToken: TOKEN, expiresAt: "2026-08-03T00:00:00.000Z" },
    });
    const result = await backups.backupRestoreAuthorize(PROJECT, PLAN_ID, 0);
    expect(text(result)).toMatchObject({ confirmationToken: TOKEN });
    expect(mockApi.post.mock.calls[0]?.[1]).not.toHaveProperty("confirmationToken");
  });

  it("registers the RESTORE-100 schemas and removes the boolean-confirm bypass", () => {
    const source = readFileSync(fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url)), "utf8");
    for (const name of ["backup_restore_preview", "backup_restore_authorize", "backup_restore_start", "backup_restore_execution_authorize", "backup_restore_execute", "backup_restore_status", "backup_restore_audit_list"]) {
      expect(source).toMatch(new RegExp(`server\\.registerTool\\(\\s*"${name}"`));
    }
    expect(source).toMatch(/backup_restore_preview[\s\S]*?dryRun: z\.literal\(true\)/);
    expect(source).toMatch(/backup_restore_start[\s\S]*?confirmationToken: z\.string\(\)\.min\(32\)/);
    expect(source).toMatch(/backup_restore_execute[\s\S]*?executionToken: z\.string\(\)\.min\(32\)/);
    expect(source).not.toMatch(/backup_restore_execute[\s\S]*?(?:path|pid|argv): z\./);
    expect(source).not.toContain("confirm: true");
  });
});
