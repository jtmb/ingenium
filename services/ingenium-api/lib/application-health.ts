import { projects, synthesis } from "ingenium-core";
import { getSynthesisInterval } from "./synthesis-cadence.js";

export type ApplicationState =
  | "healthy"
  | "degraded"
  | "stopped"
  | "starting"
  | "idle"
  | "disabled"
  | "error"
  | "unknown";

export type ApplicationScope = { kind: "installation" } | { kind: "project"; projectId: string; projectName: string };

export interface ApplicationHealth {
  scope?: ApplicationScope;
  name: string;
  state: ApplicationState;
  description: string;
  detail?: string;
  /** Whether a non-healthy state must affect aggregate system health. */
  required: boolean;
}

/**
 * A required application is healthy only when it reports a healthy state.
 * Optional applications intentionally report idle or disabled instead of
 * contributing a failure to aggregate health.
 */
export function hasRequiredApplicationIssue(application: ApplicationHealth): boolean {
  return application.required && application.state !== "healthy";
}

/**
 * Email-client health. Email is optional until at least one account exists;
 * an unconfigured mail engine therefore reports idle rather than stopped or
 * degraded, even when the engine has not been started yet.
 */
export async function getEmailClientStatus(): Promise<ApplicationHealth> {
  try {
    const email = await import("ingenium-email");
    const accountCount = email.listAccounts().length;

    if (accountCount === 0) {
      return {
        name: "email-client",
        state: "idle",
        description: "Mail sync engine — no accounts configured",
        detail: "Add an email account to begin syncing",
        required: false,
      };
    }

    const engine = email.getEngineStatus();
    if (!engine.running) {
      return {
        name: "email-client",
        state: "stopped",
        description: "Mail sync engine",
        detail: "Engine not running",
        required: true,
      };
    }
    if (!engine.heartbeatAt) {
      return {
        name: "email-client",
        state: "starting",
        description: "Mail sync engine",
        detail: "Engine active, awaiting first heartbeat",
        required: true,
      };
    }

    const hbAge = Date.now() - new Date(engine.heartbeatAt).getTime();
    if (hbAge > 120_000) {
      return {
        name: "email-client",
        state: "degraded",
        description: "Mail sync engine",
        detail: `Heartbeat stale (${Math.round(hbAge / 1000)}s)`,
        required: true,
      };
    }

    const allErrorAccounts = engine.accounts.filter(
      (account) => account.folders.length > 0 && account.folders.every((folder) => folder.state === "error"),
    );
    if (engine.accounts.length > 0 && allErrorAccounts.length === engine.accounts.length) {
      return {
        name: "email-client",
        state: "degraded",
        description: "Mail sync engine",
        detail: "Re-authentication required",
        required: true,
      };
    }

    return {
      name: "email-client",
      state: "healthy",
      description: `Mail sync engine — ${accountCount} account(s) connected`,
      detail: `${accountCount} account(s) connected`,
      required: true,
    };
  } catch {
    return {
      name: "email-client",
      state: "error",
      description: "Mail sync engine",
      detail: "Internal error",
      required: true,
    };
  }
}

export interface SynthesisHealthSnapshot {
  application: ApplicationHealth;
  intervalMs: number;
  /** Compatibility alias: this timestamp records an observation being processed. */
  lastRunAt: string | null;
  lastProcessedAt: string | null;
  /** Processing timestamps do not establish the scheduler's next check time. */
  nextEstimate: null;
  stats: { totalObservations: number; pendingCount: number; processedCount: number; traitCount: number } | null;
}

/** Read activity once, using a real project ID and the scheduler's configured cadence. */
export function getSynthesisHealthSnapshot(projectId?: string): SynthesisHealthSnapshot {
  const intervalMs = getSynthesisInterval();
  const base = { intervalMs, lastRunAt: null, lastProcessedAt: null, nextEstimate: null, stats: null };
  try {
    const id = projectId ?? projects.getGlobalProject()?.id;
    if (!id) return { ...base, application: { name: "synthesis-engine", state: "idle",
      description: "Synthesis pipeline", detail: "No global project configured", required: false } };
    const status = synthesis.getSynthesisStatus(id);
    const lastProcessedAt = status.last_synthesis_at;
    const snapshot = { intervalMs, lastRunAt: lastProcessedAt, lastProcessedAt, nextEstimate: null,
      stats: { totalObservations: status.total_observations, pendingCount: status.pending_count,
        processedCount: status.processed_count, traitCount: status.trait_count } };
    const common = { name: "synthesis-engine", description: "Synthesis pipeline" };
    if (intervalMs === 0) return { ...snapshot, application: { ...common, state: "disabled",
      detail: "Automatic checks disabled", required: false } };
    const cadence = `checks every ${Math.round(intervalMs / 60000)}m`;
    if (status.pending_count === 0) return { ...snapshot, application: { ...common, state: "idle",
      detail: `No pending observations — ${cadence}`, required: false } };
    // Observation processing can be old while a scheduler is healthy (for example,
    // newly queued work after an idle period). It is not a scheduler heartbeat.
    return { ...snapshot, application: { ...common, state: "unknown",
      detail: `${status.pending_count} pending observations — ${cadence}; scheduler heartbeat unavailable`, required: false } };
  } catch {
    return { ...base, application: { name: "synthesis-engine", state: "error",
      description: "Synthesis pipeline", detail: "Synthesis activity is unavailable", required: true } };
  }
}

export function getSynthesisStatus(projectId?: string): ApplicationHealth {
  return getSynthesisHealthSnapshot(projectId).application;
}
