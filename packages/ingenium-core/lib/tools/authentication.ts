import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import type { AuthSession } from "../schema.js";

export const PASSWORD_SCRYPT_N = 65_536;
export const PASSWORD_SCRYPT_R = 8;
export const PASSWORD_SCRYPT_P = 1;
const PASSWORD_MAX_MEMORY = 128 * 1024 * 1024;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

export function hashSecurityToken(token: string): string {
  if (token.length < 32 || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid security token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function derivePassword(password: string, salt = randomBytes(16).toString("hex")): Promise<{ hash: string; salt: string }> {
  if (password.length < 12 || password.length > 1024) throw new Error("Password must be between 12 and 1024 characters");
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
  const derived = await derivePassword(password, salt);
  const actual = Buffer.from(derived.hash, "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSession(userId: string, now = new Date()): { session: AuthSession; token: string } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSecurityToken(token);
  const session = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const id = randomUUID();
    const createdAt = now.toISOString();
    database.prepare(
      `INSERT INTO auth_sessions
       (id, user_id, token_hash, idle_expires_at, absolute_expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, tokenHash, new Date(now.getTime() + SESSION_IDLE_MS).toISOString(),
      new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString(), createdAt, createdAt);
    return database.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(id) as AuthSession;
  });
  checkpointAfterWrite();
  return { session, token };
}

export function resolveSession(token: string, now = new Date()): AuthSession | undefined {
  const tokenHash = hashSecurityToken(token);
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL
     AND idle_expires_at > ? AND absolute_expires_at > ?`,
  ).get(tokenHash, now.toISOString(), now.toISOString()) as AuthSession | undefined;
}

export function revokeSession(userId: string, sessionId: string): boolean {
  const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
  ).run(new Date().toISOString(), sessionId, userId).changes === 1);
  if (changed) checkpointAfterWrite();
  return changed;
}
