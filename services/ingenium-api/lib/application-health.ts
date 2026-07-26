import { pipelineEvents, settings, synthesis } from "ingenium-core";

export type ApplicationState =
  | "healthy"
  | "degraded"
  | "stopped"
  | "starting"
  | "idle"
  | "disabled"
  | "error"
  | "unknown";

export interface ApplicationHealth {
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
    const accountCount = email.listAccounts(email.getGlobalProjectId()).length;

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

/** Synthesis-engine health based on configured cadence and last completed run. */
export function getSynthesisStatus(): ApplicationHealth {
  try {
    const intervalMs = parseInt(
      settings.getSetting("global-default", "synthesis_interval_ms") ?? "900000",
      10,
    );
    if (intervalMs === 0) {
      return {
        name: "synthesis-engine",
        state: "disabled",
        description: "Synthesis pipeline",
        detail: "Interval set to 0 (disabled)",
        required: false,
      };
    }

    let lastRun: number | null = null;
    try {
      const status = synthesis.getSynthesisStatus("global-default");
      lastRun = status.last_synthesis_at ? new Date(status.last_synthesis_at).getTime() : null;
    } catch {
      try {
        const events = pipelineEvents.getEvents("global-default", {
          type: "synthesis_completed",
          limit: 1,
        });
        if (events.length > 0) lastRun = new Date(events[0]!.created_at).getTime();
      } catch {
        // No status source is available; the pipeline has not yet run.
      }
    }

    if (!lastRun) {
      return {
        name: "synthesis-engine",
        state: "healthy",
        description: "Synthesis pipeline",
        detail: `No runs yet — checks every ${Math.round(intervalMs / 60000)}m`,
        required: true,
      };
    }

    const age = Date.now() - lastRun;
    const detail = `Last run: ${Math.round(age / 60000)}m ago (interval: ${Math.round(intervalMs / 60000)}m)`;
    if (age <= intervalMs * 1.5) {
      return { name: "synthesis-engine", state: "healthy", description: "Synthesis pipeline", detail, required: true };
    }
    if (age <= intervalMs * 3) {
      return { name: "synthesis-engine", state: "degraded", description: "Synthesis pipeline", detail, required: true };
    }
    return {
      name: "synthesis-engine",
      state: "error",
      description: "Synthesis pipeline",
      detail: `Last run: ${Math.round(age / 60000)}m ago — may be stuck`,
      required: true,
    };
  } catch (err) {
    return {
      name: "synthesis-engine",
      state: "error",
      description: "Synthesis pipeline",
      detail: (err as Error).message,
      required: true,
    };
  }
}
