import type { EmailAccount, OAuthToken } from "./types.js";

export type OAuthClientSecretKey =
  | "oauth_gmail_client_secret"
  | "oauth_outlook_client_secret";

export interface EmailSkill {
  name: string;
  content: string;
  tags?: string | null;
  category?: string | null;
}

export interface CachedEmail {
  account_id: string;
  folder: string;
  uid: string;
  subject: string | null;
  from_name: string | null;
  from_addr: string | null;
  date: string | null;
  snippet: string | null;
  flags: string;
  has_attachments: number;
  envelope_json: string | null;
}

export interface CachedEmailBody {
  html: string | null;
  text: string | null;
  headers_json: string | null;
}

export interface EmailCacheEntry {
  uid: string;
  subject?: string | null;
  from_name?: string | null;
  from_addr?: string | null;
  date?: string | null;
  snippet?: string | null;
  flags?: string;
  has_attachments?: number;
  envelope_json?: string | null;
  labels_json?: string | null;
}

export interface EmailCacheDelta {
  upserts: Array<{ folder: string; entry: EmailCacheEntry }>;
  deletes: Array<{ folder?: string; uid: string }>;
  historyId: string;
  provider: string;
}

export interface ClaimedSuggestionJob {
  id: number;
  account_id: string;
  folder: string;
  uid: string;
}

export interface EmailSettingsTransaction {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface EmailObservation {
  observation_type: "correction" | "preference" | "pattern" | "insight" | "feedback" | "behavior" | "terminology" | "workflow" | "error" | "goal";
  content: string;
  importance: number;
}

export interface WatcherMarkerRememberResult {
  alreadyProcessed: boolean;
  newlyRecorded: boolean;
}

export interface EmailRuntime {
  accounts: {
    getGlobalProjectId(): string;
    getGlobalSetting(key: string): string | undefined;
    listGlobalSettings(prefix: string): string[];
    mutateGlobalSettings<T>(operation: (settings: EmailSettingsTransaction, projectId: string) => T): T;
    listActiveSettings(prefixes: string[]): Array<{ projectId: string; key: string; value: string }>;
  };
  settings: {
    getSetting(projectId: string, key: string): string | undefined;
  };
  oauthClientSecrets: {
    getClientSecret(projectId: string, key: OAuthClientSecretKey): string | undefined;
  };
  skills: {
    listSkills(projectId: string): EmailSkill[];
  };
  cache: {
    getCachedEmail(accountId: string, folder: string, uid: string): CachedEmail | undefined;
    getCachedEmailBody(accountId: string, folder: string, uid: string): CachedEmailBody | undefined;
    getCachedSuggestions(accountId: string, folder: string, uid: string): { suggestions_json: string } | undefined;
    getSyncState(accountId: string, folder: string): { last_synced_at: string | null };
    getAccountCursor(accountId: string): { historyId: string | null; provider: string };
    getUidsMissingBodies(accountId: string, folder: string, limit: number): string[];
    getCachedEmails(accountId: string, folder: string, page: number, limit: number): { emails: CachedEmail[]; total: number };
    upsertEmailCache(accountId: string, folder: string, entries: EmailCacheEntry[]): number;
    upsertEmailBody(accountId: string, folder: string, uid: string, html: string | null, text: string | null, headersJson: string | null): void;
    upsertEmailSuggestions(accountId: string, folder: string, uid: string, suggestions: Array<{ tone: string; subject: string; body: string }>, model: string | null): void;
    applyEmailCacheDelta(accountId: string, delta: EmailCacheDelta): { upserts: number; deletes: number };
    updateSyncState(accountId: string, folder: string, lastUid: string, uidValidity: number): void;
    setAccountCursor(accountId: string, historyId: string, provider: string): void;
  };
  suggestionQueue: {
    enqueueSuggestionJob(accountId: string, folder: string, uid: string): boolean;
    claimSuggestionJob(ownerToken: string, leaseMs?: number): ClaimedSuggestionJob | undefined;
    markJobComplete(jobId: number, ownerToken: string): boolean;
    markJobFailed(jobId: number, ownerToken: string, error: string): boolean;
  };
  watcherMarkers: {
    remember(projectId: string, accountId: string, folder: string, uid: string): WatcherMarkerRememberResult;
    clearAccount(projectId: string, accountId: string): number;
  };
  llm: {
    isConfigured(projectId: string): boolean;
    resolveConfig(projectId: string): { model: string; endpoint?: string; apiKey?: string; allowPrivateNetwork?: boolean } | null;
    fetch(url: string, init: RequestInit, policy: { allowPrivateNetwork: boolean; timeoutMs: number }): Promise<Response>;
  };
  logger: {
    info(scope: string, message: string, data?: Record<string, unknown>): void;
    warn(scope: string, message: string, data?: Record<string, unknown>): void;
  };
  recordObservation(projectId: string, observation: EmailObservation): Promise<void>;
}

let runtime: EmailRuntime | undefined;

export function configureEmailRuntime(next: EmailRuntime): void {
  if (runtime) throw new Error("Email runtime is already configured");
  runtime = next;
}

export function resetEmailRuntimeForTest(): void {
  runtime = undefined;
}

export function isEmailRuntimeConfigured(): boolean {
  return runtime !== undefined;
}

export function getEmailRuntime(): EmailRuntime {
  if (!runtime) throw new Error("Email runtime is not configured by the API");
  return runtime;
}

export type { EmailAccount, OAuthToken };
