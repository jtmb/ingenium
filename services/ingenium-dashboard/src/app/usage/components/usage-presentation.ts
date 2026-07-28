import type { UsageAvailability, UsageMetricValue, UsageQuery, UsageStatus } from "@/lib/api";

export const USAGE_STALE_AFTER_MS = 15 * 60_000;

export interface UsageFilterDraft {
  from: string;
  to: string;
  providerId: string;
  modelId: string;
  agentId: string;
  status: UsageStatus | "";
}

export type UsageFilterValidation =
  | { ok: true; query: UsageQuery }
  | { ok: false; message: string };

export function defaultUsageFilterDraft(referenceDate = new Date()): UsageFilterDraft {
  const to = new Date(referenceDate.getTime());
  const from = new Date(referenceDate.getTime() - 30 * 86_400_000);
  return {
    from: toUtcInputValue(from.toISOString()),
    to: toUtcInputValue(to.toISOString()),
    providerId: "",
    modelId: "",
    agentId: "",
    status: "",
  };
}

export function toUtcInputValue(iso: string): string {
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 16) : "";
}

export function utcInputValueToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}:00.000Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function validateUsageFilters(draft: UsageFilterDraft): UsageFilterValidation {
  const from = utcInputValueToIso(draft.from);
  const to = utcInputValueToIso(draft.to);
  if (!from || !to) {
    return { ok: false, message: "Enter a valid UTC start and end time." };
  }
  const range = Date.parse(to) - Date.parse(from);
  if (range <= 0) {
    return { ok: false, message: "The UTC end time must be after the start time." };
  }
  if (range > 366 * 86_400_000) {
    return { ok: false, message: "Usage ranges cannot exceed 366 days." };
  }
  return {
    ok: true,
    query: {
      from,
      to,
      ...(draft.providerId ? { providerIds: [draft.providerId] } : {}),
      ...(draft.modelId ? { modelIds: [draft.modelId] } : {}),
      ...(draft.agentId ? { agentIds: [draft.agentId] } : {}),
      ...(draft.status ? { statuses: [draft.status] } : {}),
    },
  };
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
}

export function formatUsageMetric(metric: UsageMetricValue): string {
  return metric.value === null ? "Unavailable" : formatNumber(metric.value);
}

export function formatNullableNumber(value: number | null): string {
  return value === null ? "Unavailable" : formatNumber(value);
}

export function usageAvailabilityLabel(metric: UsageMetricValue): string {
  switch (metric.availability) {
    case "known":
      return "Known";
    case "partial":
      return "Partial";
    default:
      return "Unavailable";
  }
}

/** Keep a reported amount and its availability state together in tabular views. */
export function formatCostWithAvailability(value: number | null, availability: UsageAvailability): string {
  const amount = value === null ? "Unavailable" : formatCost(value);
  return `${amount} (${usageAvailabilityLabel({ value, availability })})`;
}

export function formatUtcTimestamp(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "Not available";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return `${formatted} UTC`;
}

export function freshnessState(lastSuccessfulSyncAt: string | null, referenceTime = Date.now()): "fresh" | "stale" | "unknown" {
  if (!lastSuccessfulSyncAt) return "unknown";
  const completedAt = Date.parse(lastSuccessfulSyncAt);
  if (!Number.isFinite(completedAt) || referenceTime - completedAt > USAGE_STALE_AFTER_MS) return "stale";
  return "fresh";
}

export function rawIdentifier(value: string | null): string {
  return value === null ? "Not reported" : value;
}
