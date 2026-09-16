import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { transitionEmptyEmailEncryptionKey } from "../lib/tools/email-key-transition.js";

describe("empty email encryption key transition", () => {
  let directory: string;
  let project: ReturnType<typeof createProject>;

  beforeEach(() => {
    resetDbForTest();
    directory = mkdtempSync(join(tmpdir(), "ingenium-email-key-transition-"));
    vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "data.db"));
    project = createProject("global-default", true);
    getDb().prepare("INSERT INTO settings (project_id, key, value) VALUES (?, 'email_encryption_key_fingerprint', ?)")
      .run(project.id, "a".repeat(64));
  });

  afterEach(() => {
    resetDbForTest();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("updates continuity and records metadata-only audit when every mail surface is empty", () => {
    const result = transitionEmptyEmailEncryptionKey({
      projectId: project.id,
      fingerprint: "b".repeat(64),
      actorType: "system",
      actorId: "deployment",
      requestId: "rotation-test",
    });

    expect(result).toMatchObject({ status: "transitioned", auditId: expect.any(String) });
    expect(getDb().prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'email_encryption_key_fingerprint'").get(project.id))
      .toEqual({ value: "b".repeat(64) });
    expect(getDb().prepare(
      "SELECT action, actor_type, actor_id, request_id FROM resource_audit_events WHERE action = 'mail.email_key_empty_transition'",
    ).get()).toEqual({
      action: "mail.email_key_empty_transition",
      actor_type: "system",
      actor_id: "deployment",
      request_id: "rotation-test",
    });
  });

  it("blocks without mutation when any account or ciphertext exists", () => {
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO mail_accounts
      (id, organization_id, owner_kind, email, name, provider, auth_type, config_json,
       created_by_actor_type, created_at, updated_at)
      VALUES ('blocked-account', ?, 'organization', 'blocked@example.test', 'Blocked', 'custom', 'app_password', '{}', 'system', ?, ?)`)
      .run(project.organization_id, now, now);

    expect(transitionEmptyEmailEncryptionKey({
      projectId: project.id,
      fingerprint: "b".repeat(64),
      actorType: "system",
    })).toEqual({ status: "blocked" });
    expect(getDb().prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'email_encryption_key_fingerprint'").get(project.id))
      .toEqual({ value: "a".repeat(64) });
  });

  it("rolls back when a mail dependency appears during the guarded update", () => {
    const now = new Date().toISOString();
    getDb().exec(`CREATE TRIGGER inject_mail_dependency_before_key_transition
      BEFORE UPDATE ON settings WHEN OLD.key = 'email_encryption_key_fingerprint' BEGIN
        INSERT INTO mail_oauth_attempts
          (state_hash, organization_id, owner_kind, account_id, provider, actor_type, expires_at, created_at)
        VALUES ('${"c".repeat(64)}', '${project.organization_id}', 'organization', 'concurrent-account', 'gmail', 'system', '${now}', '${now}');
      END`);

    expect(transitionEmptyEmailEncryptionKey({
      projectId: project.id,
      fingerprint: "b".repeat(64),
      actorType: "system",
    })).toEqual({ status: "concurrent_change" });
    expect(getDb().prepare("SELECT value FROM settings WHERE project_id = ? AND key = 'email_encryption_key_fingerprint'").get(project.id))
      .toEqual({ value: "a".repeat(64) });
    expect(getDb().prepare("SELECT count(*) AS count FROM mail_oauth_attempts").get()).toEqual({ count: 0 });
  });
});
