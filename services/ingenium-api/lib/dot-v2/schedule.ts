import type { Schedule, MissedPolicy } from "../../../../packages/veyra-automation/contracts.js";
export interface DuePlan { due: string[]; skipped: number; through: string }
const MINUTE = 60_000;
export const MAX_WINDOW_MS = 8 * 24 * 60 * MINUTE;

function instant(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new RangeError("Expected canonical UTC timestamp");
  return result;
}

export function validateSchedule(schedule: Schedule): void {
  if (!schedule || typeof schedule !== "object") throw new RangeError("Invalid schedule");
  if (schedule.kind === "once") { instant(schedule.at); return; }
  if (schedule.kind === "interval") {
    instant(schedule.anchor);
    if (!Number.isSafeInteger(schedule.minutes) || schedule.minutes < 1 || schedule.minutes > 525600) throw new RangeError("Invalid interval");
    return;
  }
  if (schedule.kind !== "calendar") throw new RangeError("Unknown schedule kind");
  if (!Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 || !Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) throw new RangeError("Invalid wall time");
  if (!["earlier", "later", "both"].includes(schedule.fold)) throw new RangeError("Explicit DST fold policy required");
  if (schedule.weekdays && (!Array.isArray(schedule.weekdays) || !schedule.weekdays.length || schedule.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw new RangeError("Invalid weekdays");
  if (typeof schedule.timeZone !== "string" || !schedule.timeZone.trim()) throw new RangeError("Explicit timezone required");
  new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone }).format(0);
}

export function planDue(schedule: Schedule, after: string, now: string, policy: MissedPolicy, graceMs = 60_000): DuePlan {
  validateSchedule(schedule);
  const start = instant(after), end = instant(now);
  if (end < start || end - start > MAX_WINDOW_MS) throw new RangeError("Reconciliation window must be ordered and at most eight days");
  if (!["skip", "latest", "all"].includes(policy) || !Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > MAX_WINDOW_MS) throw new RangeError("Invalid missed-run policy");
  const occurrences: number[] = [];
  if (schedule.kind === "once") {
    const at = instant(schedule.at);
    if (at > start && at <= end) occurrences.push(at);
  } else if (schedule.kind === "interval") {
    const anchor = instant(schedule.anchor), step = schedule.minutes * MINUTE;
    for (let at = anchor + Math.max(0, Math.floor((start - anchor) / step) + 1) * step; at <= end; at += step) occurrences.push(at);
  } else {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
    const parts = (at: number) => Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value]));
    const key = (p: Record<string, string>) => [p.year, p.month, p.day, p.hour, p.minute].join("-");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let at = Math.floor(start / MINUTE) * MINUTE + MINUTE; at <= end; at += MINUTE) {
      const p = parts(at);
      if (Number(p.hour) !== schedule.hour || Number(p.minute) !== schedule.minute || (schedule.weekdays && !schedule.weekdays.includes(days.indexOf(p.weekday ?? "")))) continue;
      // Search both sides of a fold, including non-hour transitions. Gaps have no matching instant.
      let earlier = false, later = false;
      if (schedule.fold !== "both") for (let delta = MINUTE; delta <= 24 * 60 * MINUTE; delta += MINUTE) {
        if (!earlier && key(parts(at - delta)) === key(p)) earlier = true;
        if (!later && key(parts(at + delta)) === key(p)) later = true;
      }
      if ((schedule.fold === "earlier" && earlier) || (schedule.fold === "later" && later)) continue;
      occurrences.push(at);
    }
  }
  let selected = occurrences;
  if (policy === "latest") selected = occurrences.slice(-1);
  if (policy === "skip") selected = occurrences.filter(at => end - at <= graceMs);
  if (selected.length > 100) throw new RangeError("More than 100 due occurrences; reconcile smaller windows");
  return { due: selected.map(at => new Date(at).toISOString()), skipped: occurrences.length - selected.length, through: now };
}
