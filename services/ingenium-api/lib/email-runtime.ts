import {
  checkpointAfterWrite,
  emailCache,
  emailSuggestionQueue,
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
