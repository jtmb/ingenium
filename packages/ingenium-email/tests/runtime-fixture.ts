import type { EmailRuntime } from "../lib/runtime.js";

export function createMemoryEmailRuntime(
  values = new Map<string, string>(),
  globalProjectId = "global-project-id",
): EmailRuntime {
  const key = (projectId: string, setting: string) => `${projectId}\u0000${setting}`;
  const watcherMarkerKey = (projectId: string, accountId: string, folder: string, uid: string) => (
    `${projectId}\u0000${accountId}\u0000${folder}\u0000${uid}`
  );
  const watcherMarkers = new Map<string, { projectId: string; accountId: string }>();
  const get = (setting: string) => values.get(key(globalProjectId, setting));
  const set = (setting: string, value: string) => values.set(key(globalProjectId, setting), value);

  return {
    accounts: {
      getGlobalProjectId: () => globalProjectId,
      getGlobalSetting: get,
      listGlobalSettings: (prefix) => [...values]
        .filter(([entry]) => entry.startsWith(`${globalProjectId}\u0000${prefix}`))
        .map(([, value]) => value),
      mutateGlobalSettings: (operation) => operation({
        get,
        set,
        delete: (setting) => values.delete(key(globalProjectId, setting)),
      }, globalProjectId),
      listActiveSettings: (prefixes) => [...values].flatMap(([entry, value]) => {
        const separator = entry.indexOf("\u0000");
        const projectId = entry.slice(0, separator);
        const setting = entry.slice(separator + 1);
        return prefixes.some((prefix) => setting.startsWith(prefix))
          ? [{ projectId, key: setting, value }]
          : [];
      }),
    },
    settings: {
      getSetting: (projectId, setting) => values.get(key(projectId, setting)),
    },
    oauthClientSecrets: {
      getClientSecret: (projectId, setting) => values.get(key(projectId, setting)),
    },
    skills: { listSkills: () => [] },
    cache: {
      getCachedEmail: () => undefined,
      getCachedEmailBody: () => undefined,
      getCachedSuggestions: () => undefined,
      getSyncState: () => ({ last_synced_at: null }),
      getAccountCursor: () => ({ historyId: null, provider: "imap" }),
      getUidsMissingBodies: () => [],
      getCachedEmails: () => ({ emails: [], total: 0 }),
      upsertEmailCache: () => 0,
      upsertEmailBody: () => {},
      upsertEmailSuggestions: () => {},
      applyEmailCacheDelta: () => ({ upserts: 0, deletes: 0 }),
      updateSyncState: () => {},
      setAccountCursor: () => {},
    },
    suggestionQueue: {
      enqueueSuggestionJob: () => false,
      claimSuggestionJob: () => undefined,
      markJobComplete: () => false,
      markJobFailed: () => false,
    },
    watcherMarkers: {
      remember: (projectId, accountId, folder, uid) => {
        const marker = watcherMarkerKey(projectId, accountId, folder, uid);
        if (watcherMarkers.has(marker)) {
          return { alreadyProcessed: true, newlyRecorded: false };
        }
        watcherMarkers.set(marker, { projectId, accountId });
        return { alreadyProcessed: false, newlyRecorded: true };
      },
      clearAccount: (projectId, accountId) => {
        let deleted = 0;
        for (const [marker, scope] of watcherMarkers) {
          if (scope.projectId !== projectId || scope.accountId !== accountId) continue;
          watcherMarkers.delete(marker);
          deleted++;
        }
        return deleted;
      },
    },
    llm: {
      isConfigured: () => false,
      resolveConfig: () => null,
      fetch: async () => new Response(null, { status: 503 }),
    },
    logger: { info: () => {}, warn: () => {} },
    recordObservation: async () => {},
  };
}

export function createCoreEmailRuntime(core: typeof import("ingenium-core")): EmailRuntime {
  const resolveGlobalProjectId = () => {
    const global = core.projects.getCanonicalGlobalProject();
    if (!global) throw new Error("No canonical global project found");
    return global.id;
  };

  return {
    ...createMemoryEmailRuntime(),
    accounts: {
      getGlobalProjectId: resolveGlobalProjectId,
      getGlobalSetting: (key) => core.settings.getSetting(resolveGlobalProjectId(), key),
      listGlobalSettings: (prefix) => (core.getDb().prepare(
        "SELECT value FROM settings WHERE project_id = ? AND key LIKE ?",
      ).all(resolveGlobalProjectId(), `${prefix}%`) as Array<{ value: string }>).map((row) => row.value),
      mutateGlobalSettings: (operation) => {
        const result = core.execTransaction(() => {
          const db = core.getDb();
          const projectId = resolveGlobalProjectId();
          return operation({
            get: (key) => (db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = ?")
              .get(projectId, key) as { value: string } | undefined)?.value,
            set: (key, value) => {
              db.prepare(
                `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
              ).run(projectId, key, value);
            },
            delete: (key) => {
              db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?").run(projectId, key);
            },
          }, projectId);
        });
        core.checkpointAfterWrite();
        return result;
      },
      listActiveSettings: (prefixes) => {
        const conditions = prefixes.map(() => "s.key LIKE ?").join(" OR ");
        return core.getDb().prepare(
          `SELECT s.project_id AS projectId, s.key, s.value
           FROM settings s
           JOIN projects p ON p.id = s.project_id
           WHERE p.archived_at IS NULL AND (${conditions})`,
        ).all(...prefixes.map((prefix) => `${prefix}%`)) as Array<{ projectId: string; key: string; value: string }>;
      },
    },
    settings: { getSetting: core.settings.getSetting },
    oauthClientSecrets: {
      getClientSecret: (projectId, key) => core.protectedSettings.getOAuthClientSecret(projectId, key),
    },
    skills: { listSkills: core.skills.listSkills },
    cache: core.emailCache,
    suggestionQueue: core.emailSuggestionQueue,
    watcherMarkers: core.emailWatcherMarkers,
    llm: {
      isConfigured: core.synthesisLlm.isLLMSynthesisConfigured,
      resolveConfig: (projectId) => core.synthesisLlm.resolveLLMConfig(projectId),
      fetch: core.safeLlmFetch,
    },
    logger: core.logger,
    async recordObservation(projectId, observation) {
      core.observations.storeObservation(
        projectId,
        observation.observation_type,
        observation.content,
        observation.importance,
        "email",
      );
    },
  };
}
