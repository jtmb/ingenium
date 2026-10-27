import { projects, settings } from "ingenium-core";

const configuredDefault = Number.parseInt(process.env.SYNTHESIS_INTERVAL_MS ?? "900000", 10);
export const SYNTHESIS_DEFAULT_MS = Number.isFinite(configuredDefault) && configuredDefault >= 0 ? configuredDefault : 900000;

/** The scheduler and its status view must read the same active-global cadence. */
export function getSynthesisInterval(): number {
  try {
    const globalId = projects.getGlobalProject()?.id;
    if (globalId) {
      const value = settings.getSetting(globalId, "synthesis_interval_ms");
      if (value !== undefined) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
      }
    }
  } catch { /* Preserve the scheduler's environment/default fallback. */ }
  return SYNTHESIS_DEFAULT_MS;
}
