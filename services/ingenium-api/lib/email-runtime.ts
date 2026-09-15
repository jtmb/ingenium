import {
  checkpointAfterWrite,
  emailCache,
  emailSuggestionQueue,
  emailWatcherMarkers,
  execTransaction,
  getDb,
  logger,
  observations,
  protectedSettings,
  projects,
  safeLlmFetch,
  settings,
  skills,
  synthesisLlm,
} from "ingenium-core";
import {
  configureEmailRuntime,
  isEmailRuntimeConfigured,
  type EmailRuntime,
} from "ingenium-email";

function resolveGlobalProjectId(): string {
  const global = projects.getCanonicalGlobalProject();
  if (!global) throw new Error("No canonical global project found. Create global-default before using email.");
  return global.id;
}

const runtime: EmailRuntime = {
  accounts: {
    getGlobalProjectId: resolveGlobalProjectId,
    getGlobalSetting(key) {
      return settings.getSetting(resolveGlobalProjectId(), key);
    },
    listGlobalSettings(prefix) {
      const projectId = resolveGlobalProjectId();
      return (getDb().prepare(
        "SELECT value FROM settings WHERE project_id = ? AND key LIKE ?",
      ).all(projectId, `${prefix}%`) as Array<{ value: string }>).map((row) => row.value);
    },
    mutateGlobalSettings(operation) {
      const result = execTransaction(() => {
        const db = getDb();
        const projectId = resolveGlobalProjectId();
        const transaction = {
          get(key: string): string | undefined {
            return (db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = ?")
              .get(projectId, key) as { value: string } | undefined)?.value;
          },
          set(key: string, value: string): void {
            db.prepare(
              `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
               ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
            ).run(projectId, key, value);
          },
          delete(key: string): void {
            db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?").run(projectId, key);
          },
        };
        return operation(transaction, projectId);
      });
      checkpointAfterWrite();
      return result;
    },
    listActiveSettings(prefixes) {
      if (prefixes.length === 0) return [];
      const conditions = prefixes.map(() => "s.key LIKE ?").join(" OR ");
      return getDb().prepare(
        `SELECT s.project_id AS projectId, s.key, s.value
         FROM settings s
         JOIN projects p ON p.id = s.project_id
         WHERE p.archived_at IS NULL AND (${conditions})`,
      ).all(...prefixes.map((prefix) => `${prefix}%`)) as Array<{ projectId: string; key: string; value: string }>;
    },
    listAccounts(owner) {
      const params: unknown[] = [];
      const filters = ["1 = 1"];
      if (owner?.organizationId) { filters.push("organization_id = ?"); params.push(owner.organizationId); }
      if (owner?.ownerKind) { filters.push("owner_kind = ?"); params.push(owner.ownerKind); }
      if (owner?.ownerUserId) { filters.push("owner_user_id = ?"); params.push(owner.ownerUserId); }
      return (getDb().prepare(
        `SELECT id, organization_id AS organizationId, owner_kind AS ownerKind, owner_user_id AS ownerUserId,
                email, name, provider, auth_type AS authType, connected, hidden, last_sync AS lastSync, config_json
         FROM mail_accounts WHERE ${filters.join(" AND ")} ORDER BY created_at, id`,
      ).all(...params) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        connected: row.connected === 1,
        hidden: row.hidden === 1,
        ...JSON.parse(row.config_json as string),
      })) as EmailRuntime["accounts"] extends { listAccounts: (...args: any[]) => infer R } ? R : never;
    },
    getAccount(organizationId, accountId) {
      return this.listAccounts!({ organizationId }).find((account) => account.id === accountId);
    },
    createAccount(account) {
      getDb().prepare(
        `INSERT INTO mail_accounts
         (id, organization_id, owner_kind, owner_user_id, email, name, provider, auth_type, config_json,
          connected, hidden, last_sync, created_by_actor_type, created_by_actor_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', NULL, ?, ?)`,
      ).run(account.id, account.organizationId, account.ownerKind, account.ownerUserId ?? null, account.email, account.name,
        account.provider, account.authType, JSON.stringify({ imapHost: account.imapHost, imapPort: account.imapPort, smtpHost: account.smtpHost, smtpPort: account.smtpPort }),
        account.connected ? 1 : 0, account.hidden ? 1 : 0, account.lastSync ?? null, new Date().toISOString(), new Date().toISOString());
    },
    updateAccount(account) {
      getDb().prepare(
        `UPDATE mail_accounts SET email = ?, name = ?, provider = ?, auth_type = ?, config_json = ?, connected = ?, hidden = ?,
          last_sync = ?, revision = revision + 1, updated_at = ? WHERE organization_id = ? AND id = ?`,
      ).run(account.email, account.name, account.provider, account.authType,
        JSON.stringify({ imapHost: account.imapHost, imapPort: account.imapPort, smtpHost: account.smtpHost, smtpPort: account.smtpPort }),
        account.connected ? 1 : 0, account.hidden ? 1 : 0, account.lastSync ?? null, new Date().toISOString(), account.organizationId, account.id);
    },
    deleteAccount(organizationId, accountId) {
      getDb().prepare("DELETE FROM mail_accounts WHERE organization_id = ? AND id = ?").run(organizationId, accountId);
    },
    getCredential(organizationId, accountId, kind) {
      const row = getDb().prepare(
        "SELECT encrypted_value AS encryptedValue, token_metadata_json AS tokenMetadata FROM mail_account_credentials WHERE organization_id = ? AND account_id = ? AND credential_kind = ?",
      ).get(organizationId, accountId, kind) as { encryptedValue: string; tokenMetadata: string } | undefined;
      return row;
    },
    setCredential(organizationId, accountId, kind, encryptedValue, tokenMetadata = "{}") {
      const now = new Date().toISOString();
      getDb().prepare(
        `INSERT INTO mail_account_credentials
         (organization_id, account_id, credential_kind, encrypted_value, token_metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, account_id, credential_kind) DO UPDATE SET
           encrypted_value = excluded.encrypted_value, token_metadata_json = excluded.token_metadata_json,
           version = mail_account_credentials.version + 1, updated_at = excluded.updated_at`,
      ).run(organizationId, accountId, kind, encryptedValue, tokenMetadata, now, now);
    },
    deleteCredentials(organizationId, accountId) {
      getDb().prepare("DELETE FROM mail_account_credentials WHERE organization_id = ? AND account_id = ?").run(organizationId, accountId);
    },
    createOAuthAttempt(stateHash, attempt) {
      getDb().prepare(
        `INSERT INTO mail_oauth_attempts
         (state_hash, organization_id, owner_kind, owner_user_id, account_id, provider,
          actor_type, actor_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(stateHash, attempt.organizationId, attempt.ownerKind, attempt.ownerUserId ?? null,
        attempt.accountId, attempt.provider, attempt.actorType, attempt.actorId ?? null,
        attempt.expiresAt, new Date().toISOString());
    },
    consumeOAuthAttempt(stateHash, organizationId, provider, actorType, actorId, now) {
      const row = getDb().prepare(
        `UPDATE mail_oauth_attempts SET consumed_at = ?
          WHERE state_hash = ? AND organization_id = ? AND provider = ?
            AND actor_type = ? AND actor_id IS ?
            AND consumed_at IS NULL AND expires_at > ?
         RETURNING organization_id AS organizationId, owner_kind AS ownerKind,
           owner_user_id AS ownerUserId, account_id AS accountId, provider,
           actor_type AS actorType, actor_id AS actorId, expires_at AS expiresAt`,
      ).get(now, stateHash, organizationId, provider, actorType, actorId ?? null, now) as ReturnType<NonNullable<EmailRuntime["accounts"]["consumeOAuthAttempt"]>>;
      return row;
    },
  },
  settings: {
    getSetting: settings.getSetting,
  },
  oauthClientSecrets: {
    getClientSecret: (projectId, key) => protectedSettings.getOAuthClientSecret(projectId, key),
  },
  skills: {
    listSkills: skills.listSkills,
  },
  cache: emailCache,
  suggestionQueue: emailSuggestionQueue,
  watcherMarkers: emailWatcherMarkers,
  llm: {
    isConfigured: synthesisLlm.isLLMSynthesisConfigured,
    resolveConfig: (projectId) => synthesisLlm.resolveLLMConfig(projectId),
    fetch: safeLlmFetch,
  },
  logger,
  async recordObservation(projectId, observation) {
    observations.storeObservation(
      projectId,
      observation.observation_type,
      observation.content,
      observation.importance,
      "email",
    );
  },
};

export function configureEmailRuntimeForApi(): void {
  if (!isEmailRuntimeConfigured()) configureEmailRuntime(runtime);
}
