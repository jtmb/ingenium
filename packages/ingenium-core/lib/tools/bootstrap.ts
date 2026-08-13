import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import type { BootstrapClaimInput, BootstrapStatus } from "../schema.js";
import { derivePassword, PASSWORD_SCRYPT_N, PASSWORD_SCRYPT_P, PASSWORD_SCRYPT_R } from "./authentication.js";
import { normalizeEmail } from "./identity.js";
import { BOOTSTRAP_ORGANIZATION_ID } from "./organizations.js";

export class BootstrapAlreadyClaimedError extends Error {
  constructor() {
    super("Bootstrap has already been claimed");
    this.name = "BootstrapAlreadyClaimedError";
  }
}

export function getBootstrapStatus(): BootstrapStatus {
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT state, revision FROM bootstrap_state WHERE singleton = 1",
  ).get() as BootstrapStatus | undefined;
  if (!row) throw new Error("Bootstrap state is unavailable");
  return row;
}

export async function claimBootstrap(input: BootstrapClaimInput): Promise<{ userId: string; organizationId: string }> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 128) throw new Error("Invalid display name");
  const credential = await derivePassword(input.password);
  const claimed = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const state = database.prepare("SELECT state FROM bootstrap_state WHERE singleton = 1").get() as { state: string } | undefined;
    const users = database.prepare("SELECT count(*) AS count FROM users").get() as { count: number };
    if (!state || state.state !== "pending" || users.count !== 0) throw new BootstrapAlreadyClaimedError();
    const userId = randomUUID();
    const identityId = randomUUID();
    const now = new Date().toISOString();
    database.prepare("INSERT INTO users (id, email_normalized, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, email, displayName, now, now);
    database.prepare("INSERT INTO auth_identities (id, user_id, provider, issuer, subject, created_at, updated_at) VALUES (?, ?, 'local', 'ingenium:local', ?, ?, ?)")
      .run(identityId, userId, email, now, now);
    database.prepare(
      `INSERT INTO password_credentials
       (user_id, password_hash, salt, scrypt_n, scrypt_r, scrypt_p, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, credential.hash, credential.salt, PASSWORD_SCRYPT_N, PASSWORD_SCRYPT_R, PASSWORD_SCRYPT_P, now, now);
    database.prepare("INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)")
      .run(BOOTSTRAP_ORGANIZATION_ID, userId, now, now);
    database.prepare("INSERT INTO installation_admins (user_id, created_at) VALUES (?, ?)").run(userId, now);
    database.prepare(
      "UPDATE bootstrap_state SET state = 'claimed', owner_user_id = ?, claimed_at = ?, revision = revision + 1, updated_at = ? WHERE singleton = 1 AND state = 'pending'",
    ).run(userId, now, now);
    return { userId, organizationId: BOOTSTRAP_ORGANIZATION_ID };
  });
  checkpointAfterWrite();
  return claimed;
}
