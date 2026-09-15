import type {
  UsageAdvisoryMetric,
  UsageAdvisoryThresholdReplacement,
  UsageAdvisoryThresholds,
  UsageAttentionFreshness,
  UsageAttentionMetric,
  UsageAttentionSeverity,
  UsageAvailability,
  UsageMetricValue,
  UsageQuery,
  UsageStatus,
} from "@/lib/api";

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

export type UsageThresholdField = keyof Pick<
  UsageAdvisoryThresholds,
  "requestCount" | "totalTokens" | "reportedCostAmount" | "cacheReadTokens" | "cacheWriteTokens"
>;

export type UsageThresholdDraft = Record<UsageThresholdField, string>;

export const USAGE_THRESHOLD_FIELDS: Array<{
  key: UsageThresholdField;
  label: string;
  integer: boolean;
}> = [
  { key: "requestCount", label: "Requests", integer: true },
  { key: "totalTokens", label: "Total tokens", integer: true },
  { key: "reportedCostAmount", label: "Reported cost amount", integer: false },
  { key: "cacheReadTokens", label: "Cache read tokens", integer: true },
  { key: "cacheWriteTokens", label: "Cache write tokens", integer: true },
];

export function thresholdsToDraft(thresholds: UsageAdvisoryThresholds): UsageThresholdDraft {
  return {
    requestCount: thresholds.requestCount === null ? "" : String(thresholds.requestCount),
    totalTokens: thresholds.totalTokens === null ? "" : String(thresholds.totalTokens),
    reportedCostAmount: thresholds.reportedCostAmount === null ? "" : String(thresholds.reportedCostAmount),
    cacheReadTokens: thresholds.cacheReadTokens === null ? "" : String(thresholds.cacheReadTokens),
    cacheWriteTokens: thresholds.cacheWriteTokens === null ? "" : String(thresholds.cacheWriteTokens),
  };
}

function thresholdValue(value: string, label: string, integer: boolean): number | null | string {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isSafeInteger(parsed))) {
    return `${label} must be a ${integer ? "non-negative integer" : "finite non-negative number"}.`;
  }
  return parsed;
}

export function validateUsageThresholdDraft(
  draft: UsageThresholdDraft,
  expectedRevision: number,
): { ok: true; replacement: UsageAdvisoryThresholdReplacement } | { ok: false; message: string } {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { ok: false, message: "Threshold revision is unavailable. Reload before saving." };
  const values = Object.fromEntries(USAGE_THRESHOLD_FIELDS.map((field) => [
    field.key,
    thresholdValue(draft[field.key], field.label, field.integer),
  ])) as Record<UsageThresholdField, number | null | string>;
  const invalid = Object.values(values).find((value): value is string => typeof value === "string");
  if (invalid) return { ok: false, message: invalid };
  return {
    ok: true,
    replacement: {
      expectedRevision,
      requestCount: values.requestCount as number | null,
      totalTokens: values.totalTokens as number | null,
      reportedCostAmount: values.reportedCostAmount as number | null,
      cacheReadTokens: values.cacheReadTokens as number | null,
      cacheWriteTokens: values.cacheWriteTokens as number | null,
    },
  };
}

export function advisoryObservedLabel(metric: UsageAdvisoryMetric): string {
  if (metric.state === "disabled") return "Disabled";
  if (metric.observed === null || metric.availability === "unavailable") return "Not reported";
  const observed = formatNumber(metric.observed);
  if (metric.availability === "partial") return `${observed} (Partial — reported subtotal; Unknown — insufficient reported data to compare)`;
  if (metric.state === "unknown") return `${observed} (Unknown — insufficient reported data to compare)`;
  return observed;
}

export function advisoryStateLabel(metric: UsageAdvisoryMetric): string {
  switch (metric.state) {
    case "disabled": return "Disabled";
    case "unknown": return "Unknown — insufficient reported data to compare";
    case "below": return "Below threshold — advisory/no enforcement";
    case "equal": return "At threshold — advisory/no enforcement";
    case "above": return "Above threshold — advisory/no enforcement";
  }
}

export function attentionMetricLabel(metric: UsageAttentionMetric): string {
  switch (metric) {
    case "request_count": return "Requests";
    case "total_tokens": return "Total tokens";
    case "reported_cost_amount": return "Reported cost amount";
    case "cache_read_tokens": return "Cache read tokens";
    case "cache_write_tokens": return "Cache write tokens";
  }
}

export function attentionFreshnessLabel(freshness: UsageAttentionFreshness): string {
  switch (freshness) {
    case "disabled": return "Freshness disabled";
    case "unknown": return "Freshness unknown";
    case "fresh": return "Fresh";
    case "stale": return "Stale";
  }
}

export function attentionSeverityTone(severity: UsageAttentionSeverity): "muted" | "warning" | "critical" {
  return severity === "critical" ? "critical" : severity === "warning" ? "warning" : "muted";
}
