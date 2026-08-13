import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, authentication, getDb, identity, invitations, resetDbForTest, securityTokens } from "../lib/index.js";

let directory = "";
const originals = {
  db: process.env.INGENIUM_CORE_DB_PATH,
  key: process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE,
};

beforeEach(async () => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-authentication-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  const keyFile = join(directory, "auth-key");
  writeFileSync(keyFile, `${Buffer.alloc(32, 7).toString("base64url")}\n`, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE = keyFile;
  getDb(process.env.INGENIUM_CORE_DB_PATH);
  await bootstrap.claimBootstrap({ email: "owner@example.test", displayName: "Owner", password: "correct horse battery staple" });
});

afterEach(() => {
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  if (originals.db === undefined) delete process.env.INGENIUM_CORE_DB_PATH; else process.env.INGENIUM_CORE_DB_PATH = originals.db;
  if (originals.key === undefined) delete process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE; else process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE = originals.key;
});

describe("AUTH-101 local authentication", () => {
  it("uses generic login failures, Unicode code-point passwords, and rotates/revokes bounded sessions", async () => {
    const user = await authentication.authenticateLocal("OWNER@example.test", "correct horse battery staple");
    await expect(authentication.authenticateLocal("missing@example.test", "correct horse battery staple")).rejects.toThrow("Authentication failed");
    await expect(authentication.authenticateLocal("owner@example.test", "wrong password value")).rejects.toThrow("Authentication failed");
    await expect(authentication.derivePassword("😀😀😀😀😀😀😀😀😀😀😀😀")).resolves.toMatchObject({ hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    await expect(authentication.derivePassword("          twelve")).resolves.toBeDefined();

    const now = new Date("2026-08-13T12:00:00.000Z");
    const first = authentication.createSession(user.id, now, "test browser");
    expect(authentication.resolveSession(first.token, new Date(now.getTime() + 29 * 60_000))?.id).toBe(first.session.id);
    expect(authentication.resolveSession(first.token, new Date(now.getTime() + 31 * 60_000))).toBeUndefined();
    const rotated = authentication.rotateSession(first.token, new Date(now.getTime() + 1_000));
    expect(rotated?.token).not.toBe(first.token);
    expect(authentication.resolveSession(first.token, new Date(now.getTime() + 2_000))).toBeUndefined();
    expect(authentication.resolveSession(rotated!.token, new Date(now.getTime() + 2_000))).toBeDefined();
    const elevated = authentication.rotateSession(rotated!.token, new Date(now.getTime() + 2_000), true)!;
    expect(authentication.hasRecentStepUp(elevated.session, new Date(now.getTime() + 9 * 60_000))).toBe(true);
    expect(authentication.hasRecentStepUp(elevated.session, new Date(now.getTime() + 11 * 60_000))).toBe(false);
    expect(JSON.stringify(authentication.listSessions(user.id))).not.toContain("token_hash");
    expect(authentication.revokeSession(user.id, elevated.session.id)).toBe(true);
  });

  it("consumes reset, verification, and invitation material once", async () => {
    const user = await authentication.authenticateLocal("owner@example.test", "correct horse battery staple");
    const reset = (await authentication.issuePasswordReset(user.email_normalized))!;
    await authentication.resetPassword(reset, "a replacement password");
    await expect(authentication.resetPassword(reset, "another replacement pass")).rejects.toThrow(/invalid or expired/);
    await expect(authentication.authenticateLocal(user.email_normalized, "a replacement password")).resolves.toMatchObject({ id: user.id });

    const verification = authentication.issueEmailVerification(user.id);
    authentication.verifyEmail(verification);
    expect(() => authentication.verifyEmail(verification)).toThrow(/invalid or expired/);

    const invited = identity.createUser("invited@example.test", "Invited");
    const invite = invitations.issueInvitation("00000000-0000-4000-8000-000000000093", invited.email_normalized, "member");
    expect(invitations.previewInvitation(invite)).toMatchObject({ email: invited.email_normalized, role: "member" });
    invitations.acceptInvitation(invite, invited.id);
    expect(() => invitations.acceptInvitation(invite, invited.id)).toThrow(/invalid or expired/);
  });

  it("performs password work before accepting unknown reset accounts", async () => {
    let workCount = 0;
    expect(await authentication.issuePasswordReset("missing@example.test", () => { workCount += 1; })).toBeUndefined();
    expect(await authentication.issuePasswordReset("not-an-email", () => { workCount += 1; })).toBeUndefined();
    expect(workCount).toBe(2);
  });

  it("allows only one concurrent rotation of the same session", async () => {
    const user = await authentication.authenticateLocal("owner@example.test", "correct horse battery staple");
    const session = authentication.createSession(user.id);
    const rotations = [authentication.rotateSession(session.token), authentication.rotateSession(session.token)];
    expect(rotations.filter(Boolean)).toHaveLength(1);
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL",
    ).get(user.id)).toEqual({ count: 1 });
  });

  it("encrypts TOTP, returns recovery codes once, and consumes a recovery code once", async () => {
    const user = await authentication.authenticateLocal("owner@example.test", "correct horse battery staple");
    const enrollment = authentication.beginTotpEnrollment(user.id);
    const persisted = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT encrypted_secret FROM auth_totp_factors WHERE id = ?").get(enrollment.factorId) as { encrypted_secret: string };
    expect(persisted.encrypted_secret).not.toContain(enrollment.secret);
    const codes = authentication.confirmTotpEnrollment(user.id, enrollment.factorId, authentication.generateTotp(enrollment.secret));
    expect(codes).toHaveLength(10);
    expect(JSON.stringify(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM auth_recovery_codes").all())).not.toContain(codes[0]);
    expect(authentication.verifySecondFactor(user.id, codes[0]!)).toBe("recovery");
    expect(authentication.verifySecondFactor(user.id, codes[0]!)).toBeUndefined();
  });

  it("returns API-token plaintext once and enforces scope, expiry, revoke, and redaction", async () => {
    const user = await authentication.authenticateLocal("owner@example.test", "correct horse battery staple");
    const expiresAt = new Date(Date.now() + 60_000);
    const created = securityTokens.createScopedApiToken({ userId: user.id }, ["projects:read"], expiresAt, { name: "automation" });
    expect(created.token).toMatch(/^ing_/);
    expect(securityTokens.listUserApiTokens(user.id)[0]).not.toHaveProperty("token");
    expect(securityTokens.resolveScopedApiToken(created.token)?.scopes).toEqual(["projects:read"]);
    expect(securityTokens.resolveScopedApiToken(created.token, new Date(expiresAt.getTime() + 1))).toBeUndefined();
    expect(securityTokens.revokeScopedApiToken(created.id, user.id)).toBe(true);
    expect(securityTokens.resolveScopedApiToken(created.token)).toBeUndefined();
  });

  it("recovers only an installation operator and revokes prior sessions", async () => {
    const user = await authentication.authenticateLocal("owner@example.test", "correct horse battery staple");
    const session = authentication.createSession(user.id);
    await authentication.operatorRecoverPassword(user.id, "operator recovery password");
    expect(authentication.resolveSession(session.token)).toBeUndefined();
    await expect(authentication.authenticateLocal(user.email_normalized, "operator recovery password")).resolves.toMatchObject({ id: user.id });
  });
});
