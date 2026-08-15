import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import type { AuthSession, User } from "../schema.js";
import { normalizeEmail } from "./identity.js";

export const PASSWORD_SCRYPT_N = 65_536;
export const PASSWORD_SCRYPT_R = 8;
export const PASSWORD_SCRYPT_P = 1;
const PASSWORD_MAX_MEMORY = 128 * 1024 * 1024;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const STEP_UP_MS = 10 * 60 * 1000;
export const PASSWORD_RESET_MS = 30 * 60 * 1000;
export const EMAIL_VERIFICATION_MS = 24 * 60 * 60 * 1000;
export const INVITATION_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTH_CHALLENGE_MS = 5 * 60 * 1000;
export const SESSION_COOKIE_NAME = "__Host-ingenium_session";
const DUMMY_PASSWORD_HASH = "c7023c1c686172b09e37d640d6e8e49163ab80f1c53ab2e3f4d119d67693f09d";
const DUMMY_PASSWORD_SALT = "00000000000000000000000000000000";
const TOTP_PERIOD_SECONDS = 30;

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication failed");
    this.name = "AuthenticationError";
  }
}

export class OneTimeStateError extends Error {
  constructor() {
    super("Authentication token is invalid or expired");
    this.name = "OneTimeStateError";
  }
}

export function hashSecurityToken(token: string): string {
  if (token.length < 32 || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid security token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function passwordCodePoints(password: string): number {
  return Array.from(password).length;
}

export async function derivePassword(password: string, salt = randomBytes(16).toString("hex")): Promise<{ hash: string; salt: string }> {
  const length = passwordCodePoints(password);
  if (length < 12 || length > 1024) throw new Error("Password must be between 12 and 1024 Unicode characters");
  if (!/^[0-9a-f]{32}$/.test(salt)) throw new Error("Invalid password salt");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, Buffer.from(salt, "hex"), 32, {
      N: PASSWORD_SCRYPT_N,
      r: PASSWORD_SCRYPT_R,
      p: PASSWORD_SCRYPT_P,
      maxmem: PASSWORD_MAX_MEMORY,
    }, (error, value) => error ? reject(error) : resolve(value as Buffer));
  });
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, storedHash: string, salt: string): Promise<boolean> {
  let derived: { hash: string };
  try {
    derived = await derivePassword(password, salt);
  } catch {
    await derivePassword("invalid-password-work", DUMMY_PASSWORD_SALT);
    return false;
  }
  const actual = Buffer.from(derived.hash, "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function authenticateLocal(email: string, password: string): Promise<User> {
  let normalized: string | undefined;
  try {
    normalized = normalizeEmail(email);
  } catch {
    // Generic auth work below prevents malformed and unknown identities from becoming a cheap enumeration path.
  }
  const row = normalized ? getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT users.*, password_credentials.password_hash, password_credentials.salt
     FROM users
     JOIN auth_identities ON auth_identities.user_id = users.id AND auth_identities.provider = 'local'
     JOIN password_credentials ON password_credentials.user_id = users.id
     WHERE users.email_normalized = ?`,
  ).get(normalized) as (User & { password_hash: string; salt: string }) | undefined : undefined;
  const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH, row?.salt ?? DUMMY_PASSWORD_SALT);
  if (!row || !valid || row.status !== "active") throw new AuthenticationError();
  const { password_hash: _passwordHash, salt: _salt, ...user } = row;
  return user;
}

export function createSession(userId: string, now = new Date(), deviceLabel?: string, markStepUp = false): { session: AuthSession; token: string; csrfToken: string } {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const session = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const user = database.prepare("SELECT status, security_epoch FROM users WHERE id = ?").get(userId) as { status: string; security_epoch: number } | undefined;
    if (!user || user.status !== "active") throw new AuthenticationError();
    const id = randomUUID();
    const createdAt = now.toISOString();
    database.prepare(
      `INSERT INTO auth_sessions
       (id, user_id, token_hash, csrf_hash, security_epoch, device_label, idle_expires_at, absolute_expires_at, recent_step_up_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, hashSecurityToken(token), hashSecurityToken(csrfToken), user.security_epoch,
      deviceLabel?.slice(0, 128) || null, new Date(now.getTime() + SESSION_IDLE_MS).toISOString(),
      new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString(), markStepUp ? createdAt : null, createdAt, createdAt);
    return database.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(id) as AuthSession;
  });
  checkpointAfterWrite();
  return { session, token, csrfToken };
}

export function resolveSession(token: string, now = new Date(), touch = false): AuthSession | undefined {
  let tokenHash: string;
  try {
    tokenHash = hashSecurityToken(token);
  } catch {
    return undefined;
  }
  const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const session = database.prepare(
    `SELECT auth_sessions.* FROM auth_sessions
     JOIN users ON users.id = auth_sessions.user_id
     WHERE auth_sessions.token_hash = ? AND auth_sessions.revoked_at IS NULL
       AND auth_sessions.idle_expires_at > ? AND auth_sessions.absolute_expires_at > ?
       AND users.status = 'active' AND users.security_epoch = auth_sessions.security_epoch`,
  ).get(tokenHash, now.toISOString(), now.toISOString()) as AuthSession | undefined;
  if (!session || !touch) return session;
  const idleExpiry = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, new Date(session.absolute_expires_at).getTime())).toISOString();
  execTransaction(() => database.prepare(
    "UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ? AND revoked_at IS NULL",
  ).run(now.toISOString(), idleExpiry, session.id));
  checkpointAfterWrite();
  return { ...session, last_seen_at: now.toISOString(), idle_expires_at: idleExpiry };
}

export function verifySessionCsrf(session: AuthSession, token: string): boolean {
  try {
    const actual = Buffer.from(hashSecurityToken(token), "hex");
    const expected = Buffer.from(session.csrf_hash, "hex");
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function rotateSession(token: string, now = new Date(), markStepUp = false): ReturnType<typeof createSession> | undefined {
  let tokenHash: string;
  try {
    tokenHash = hashSecurityToken(token);
  } catch {
    return undefined;
  }
  const nextToken = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const rotated = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const timestamp = now.toISOString();
    const current = database.prepare(
      `SELECT auth_sessions.* FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = ? AND auth_sessions.revoked_at IS NULL
         AND auth_sessions.idle_expires_at > ? AND auth_sessions.absolute_expires_at > ?
         AND users.status = 'active' AND users.security_epoch = auth_sessions.security_epoch`,
    ).get(tokenHash, timestamp, timestamp) as AuthSession | undefined;
    if (!current || database.prepare(
      "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND token_hash = ? AND revoked_at IS NULL",
    ).run(timestamp, current.id, tokenHash).changes !== 1) return undefined;
    const id = randomUUID();
    const idleExpiresAt = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, new Date(current.absolute_expires_at).getTime())).toISOString();
    database.prepare(
      `INSERT INTO auth_sessions
       (id, user_id, token_hash, csrf_hash, security_epoch, device_label, idle_expires_at, absolute_expires_at, recent_step_up_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, current.user_id, hashSecurityToken(nextToken), hashSecurityToken(csrfToken), current.security_epoch,
      current.device_label, idleExpiresAt, current.absolute_expires_at,
      markStepUp ? timestamp : current.recent_step_up_at, timestamp, timestamp);
    return database.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(id) as AuthSession;
  });
  if (!rotated) return undefined;
  checkpointAfterWrite();
  return { session: rotated, token: nextToken, csrfToken };
}

export function listSessions(userId: string): Array<Omit<AuthSession, "token_hash" | "csrf_hash">> {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT id, user_id, security_epoch, device_label, idle_expires_at, absolute_expires_at,
            recent_step_up_at, revoked_at, created_at, last_seen_at
     FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
  ).all(userId) as Array<Omit<AuthSession, "token_hash" | "csrf_hash">>;
}

export function revokeSession(userId: string, sessionId: string): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
  ).run(new Date().toISOString(), sessionId, userId).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}

export function revokeAllUserSessions(userId: string, exceptSessionId?: string): number {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND (? IS NULL OR id <> ?)",
  ).run(new Date().toISOString(), userId, exceptSessionId ?? null, exceptSessionId ?? null).changes);
  if (changed) checkpointAfterWrite();
  return changed;
}

export function hasRecentStepUp(session: AuthSession, now = new Date()): boolean {
  return session.recent_step_up_at !== null && now.getTime() - new Date(session.recent_step_up_at).getTime() <= STEP_UP_MS;
}

type OneTimePurpose = "password_reset" | "email_verification" | "mfa_challenge";

function consumeOneTimeStateInTransaction(
  database: Database.Database,
  stateHash: string,
  purpose: OneTimePurpose,
  now: Date,
): { userId: string; metadata: Record<string, string> } {
  const row = database.prepare(
    `SELECT id, user_id, metadata_json FROM auth_one_time_states
     WHERE state_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?`,
  ).get(stateHash, purpose, now.toISOString()) as { id: string; user_id: string; metadata_json: string } | undefined;
  if (!row || database.prepare(
    "UPDATE auth_one_time_states SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
  ).run(now.toISOString(), row.id).changes !== 1) throw new OneTimeStateError();
  return { userId: row.user_id, metadata: JSON.parse(row.metadata_json) as Record<string, string> };
}

export function issueOneTimeState(purpose: OneTimePurpose, userId: string, expiresInMs: number, metadata: Record<string, string> = {}): string {
  const token = randomBytes(32).toString("base64url");
  execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `INSERT INTO auth_one_time_states (id, purpose, user_id, state_hash, metadata_json, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), purpose, userId, hashSecurityToken(token), JSON.stringify(metadata),
    new Date(Date.now() + expiresInMs).toISOString(), new Date().toISOString()));
  checkpointAfterWrite();
  return token;
}

export function consumeOneTimeState(token: string, purpose: OneTimePurpose, now = new Date()): { userId: string; metadata: Record<string, string> } {
  let stateHash: string;
  try {
    stateHash = hashSecurityToken(token);
  } catch {
    throw new OneTimeStateError();
  }
  const consumed = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    return consumeOneTimeStateInTransaction(database, stateHash, purpose, now);
  });
  checkpointAfterWrite();
  return consumed;
}

export async function issuePasswordReset(email: string, onPasswordWork?: () => void): Promise<string | undefined> {
  let normalized: string | undefined;
  try { normalized = normalizeEmail(email); } catch { /* Keep malformed and unknown requests on the same work path. */ }
  onPasswordWork?.();
  await verifyPassword("invalid-password-work", DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_SALT);
  const user = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT id FROM users WHERE email_normalized = ? AND status = 'active'").get(normalized ?? "") as { id: string } | undefined;
  return user ? issueOneTimeState("password_reset", user.id, PASSWORD_RESET_MS) : undefined;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const credential = await derivePassword(password);
  let tokenHash: string;
  try { tokenHash = hashSecurityToken(token); } catch { throw new OneTimeStateError(); }
  execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const now = new Date().toISOString();
    const { userId } = consumeOneTimeStateInTransaction(database, tokenHash, "password_reset", new Date(now));
    database.prepare(
      `UPDATE password_credentials SET password_hash = ?, salt = ?, scrypt_n = ?, scrypt_r = ?, scrypt_p = ?, updated_at = ?
       WHERE user_id = ?`,
    ).run(credential.hash, credential.salt, PASSWORD_SCRYPT_N, PASSWORD_SCRYPT_R, PASSWORD_SCRYPT_P, now, userId);
    database.prepare("UPDATE users SET security_epoch = security_epoch + 1, updated_at = ? WHERE id = ?").run(now, userId);
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
  });
  checkpointAfterWrite();
}

export async function operatorRecoverPassword(userId: string, password: string): Promise<void> {
  const credential = await derivePassword(password);
  execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const target = database.prepare("SELECT 1 FROM installation_admins WHERE user_id = ?").get(userId);
    if (!target) throw new Error("Operator recovery target is invalid");
    const now = new Date().toISOString();
    database.prepare("UPDATE password_credentials SET password_hash = ?, salt = ?, updated_at = ? WHERE user_id = ?")
      .run(credential.hash, credential.salt, now, userId);
    database.prepare("UPDATE users SET security_epoch = security_epoch + 1, status = 'active', updated_at = ? WHERE id = ?").run(now, userId);
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
  });
  checkpointAfterWrite();
}

export async function changePassword(userId: string, currentPassword: string, password: string): Promise<void> {
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT password_hash, salt FROM password_credentials WHERE user_id = ?",
  ).get(userId) as { password_hash: string; salt: string } | undefined;
  if (!row || !await verifyPassword(currentPassword, row.password_hash, row.salt)) throw new AuthenticationError();
  const credential = await derivePassword(password);
  execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const now = new Date().toISOString();
    database.prepare("UPDATE password_credentials SET password_hash = ?, salt = ?, updated_at = ? WHERE user_id = ?")
      .run(credential.hash, credential.salt, now, userId);
    database.prepare("UPDATE users SET security_epoch = security_epoch + 1, updated_at = ? WHERE id = ?").run(now, userId);
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
  });
  checkpointAfterWrite();
}

export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT password_credentials.password_hash, password_credentials.salt
     FROM password_credentials JOIN users ON users.id = password_credentials.user_id
     WHERE password_credentials.user_id = ? AND users.status = 'active'`,
  ).get(userId) as { password_hash: string; salt: string } | undefined;
  return verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH, row?.salt ?? DUMMY_PASSWORD_SALT);
}

export function issueEmailVerification(userId: string): string {
  return issueOneTimeState("email_verification", userId, EMAIL_VERIFICATION_MS);
}

export function verifyEmail(token: string): void {
  let tokenHash: string;
  try { tokenHash = hashSecurityToken(token); } catch { throw new OneTimeStateError(); }
  execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const now = new Date();
    const { userId } = consumeOneTimeStateInTransaction(database, tokenHash, "email_verification", now);
    database.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?")
      .run(now.toISOString(), now.toISOString(), userId);
  });
  checkpointAfterWrite();
}

function loadAuthEncryptionKey(): Buffer {
  const path = process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE;
  if (!path) throw new Error("Auth encryption key is not configured");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0
      || (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new Error("Auth encryption key file is unsafe");
    }
    const contents = readFileSync(descriptor, "utf8");
    if (!/^[A-Za-z0-9_-]{43}\n?$/.test(contents)) throw new Error("Auth encryption key is invalid");
    const encoded = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32 || key.toString("base64url") !== encoded) throw new Error("Auth encryption key is invalid");
    return key;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function validateAuthEncryptionKeyFile(): void {
  const key = loadAuthEncryptionKey();
  key.fill(0);
}

export function encryptAuthSecret(secret: string): string {
  const key = loadAuthEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  try {
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64url");
  } finally {
    key.fill(0);
  }
}

export function decryptAuthSecret(payload: string): string {
  const key = loadAuthEncryptionKey();
  const bytes = Buffer.from(payload, "base64url");
  if (bytes.length < 29) throw new Error("Invalid encrypted authentication secret");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
  } finally {
    key.fill(0);
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotp(secret: string, now = new Date()): string {
  const counter = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function verifyTotp(secret: string, code: string, now = new Date()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((window) => generateTotp(secret, new Date(now.getTime() + window * TOTP_PERIOD_SECONDS * 1000)) === code);
}

export function beginTotpEnrollment(userId: string): { factorId: string; secret: string } {
  const secret = base32Encode(randomBytes(20));
  const factorId = randomUUID();
  execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "INSERT INTO auth_totp_factors (id, user_id, encrypted_secret, created_at) VALUES (?, ?, ?, ?)",
  ).run(factorId, userId, encryptAuthSecret(secret), new Date().toISOString()));
  checkpointAfterWrite();
  return { factorId, secret };
}

export function confirmTotpEnrollment(userId: string, factorId: string, code: string, now = new Date()): string[] {
  const factor = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT encrypted_secret FROM auth_totp_factors WHERE id = ? AND user_id = ? AND enabled_at IS NULL AND revoked_at IS NULL",
  ).get(factorId, userId) as { encrypted_secret: string } | undefined;
  if (!factor || !verifyTotp(decryptAuthSecret(factor.encrypted_secret), code, now)) throw new AuthenticationError();
  const codes = Array.from({ length: 10 }, () => randomBytes(24).toString("base64url"));
  execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const timestamp = now.toISOString();
    database.prepare("UPDATE auth_totp_factors SET enabled_at = ? WHERE id = ? AND enabled_at IS NULL").run(timestamp, factorId);
    database.prepare("DELETE FROM auth_recovery_codes WHERE user_id = ?").run(userId);
    const insert = database.prepare("INSERT INTO auth_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)");
    for (const recoveryCode of codes) insert.run(randomUUID(), userId, hashSecurityToken(recoveryCode), timestamp);
    database.prepare("UPDATE users SET security_epoch = security_epoch + 1, updated_at = ? WHERE id = ?").run(timestamp, userId);
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(timestamp, userId);
  });
  checkpointAfterWrite();
  return codes;
}

export function hasTotp(userId: string): boolean {
  return Boolean(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT 1 FROM auth_totp_factors WHERE user_id = ? AND enabled_at IS NOT NULL AND revoked_at IS NULL",
  ).get(userId));
}

export function verifySecondFactor(userId: string, value: string, now = new Date()): "totp" | "recovery" | undefined {
  const factor = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT encrypted_secret FROM auth_totp_factors WHERE user_id = ? AND enabled_at IS NOT NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
  ).get(userId) as { encrypted_secret: string } | undefined;
  if (factor && verifyTotp(decryptAuthSecret(factor.encrypted_secret), value, now)) return "totp";
  let hash: string;
  try { hash = hashSecurityToken(value); } catch { return undefined; }
  const consumed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE auth_recovery_codes SET consumed_at = ? WHERE user_id = ? AND code_hash = ? AND consumed_at IS NULL",
  ).run(now.toISOString(), userId, hash).changes === 1);
  if (consumed) {
    checkpointAfterWrite();
    return "recovery";
  }
  return undefined;
}

export function removeTotp(userId: string, value: string, now = new Date()): void {
  if (!verifySecondFactor(userId, value, now)) throw new AuthenticationError();
  execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const timestamp = now.toISOString();
    database.prepare("UPDATE auth_totp_factors SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(timestamp, userId);
    database.prepare("DELETE FROM auth_recovery_codes WHERE user_id = ?").run(userId);
    database.prepare("UPDATE users SET security_epoch = security_epoch + 1, updated_at = ? WHERE id = ?").run(timestamp, userId);
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(timestamp, userId);
  });
  checkpointAfterWrite();
}

export function getUserForSession(session: AuthSession): User | undefined {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT id, email_normalized, display_name, status, email_verified_at, security_epoch, created_at, updated_at FROM users WHERE id = ?",
  ).get(session.user_id) as User | undefined;
}

export type { AuthSession } from "../schema.js";
