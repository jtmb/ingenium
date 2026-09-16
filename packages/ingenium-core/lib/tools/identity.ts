import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import type { User } from "../schema.js";

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !normalized.includes("@") || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Invalid email address");
  }
  return normalized;
}

export function createUser(email: string, displayName: string): User {
  const emailNormalized = normalizeEmail(email);
  const name = displayName.trim();
  if (name.length < 1 || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Invalid display name");
  const user = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(
      "INSERT INTO users (id, email_normalized, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, emailNormalized, name, now, now);
    return database.prepare("SELECT * FROM users WHERE id = ?").get(id) as User;
  });
  checkpointAfterWrite();
  return user;
}

export function getUser(userId: string): User | undefined {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM users WHERE id = ?").get(userId) as User | undefined;
}
