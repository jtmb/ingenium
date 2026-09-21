import { describe, expect, it } from "vitest";
import {
  defaultUsageFilterDraft,
  formatCostWithAvailability,
  freshnessState,
  formatUsageMetric,
  advisoryObservedLabel,
  attentionFreshnessLabel,
  usageAvailabilityLabel,
  utcInputValueToIso,
  validateUsageThresholdDraft,
  validateUsageFilters,
} from "../src/app/usage/components/usage-presentation";

describe("usage presentation helpers", () => {
  it("treats datetime-local filter values as UTC and preserves filter bounds", () => {
    expect(utcInputValueToIso("2026-04-03T08:45")).toBe("2026-04-03T08:45:00.000Z");
    expect(validateUsageFilters({
      from: "2026-04-03T08:45",
      to: "2026-04-04T08:45",
      providerId: "Provider/Exact-ID",
      modelId: "Model/Exact-ID",
      agentId: "agent/Exact-ID",
      status: "partial",
    })).toEqual({
      ok: true,
      query: {
        from: "2026-04-03T08:45:00.000Z",
        to: "2026-04-04T08:45:00.000Z",
        providerIds: ["Provider/Exact-ID"],
        modelIds: ["Model/Exact-ID"],
        agentIds: ["agent/Exact-ID"],
        statuses: ["partial"],
      },
    });
  });

  it("rejects invalid and oversized UTC ranges", () => {
    expect(validateUsageFilters({ from: "", to: "2026-04-04T08:45", providerId: "", modelId: "", agentId: "", status: "" })).toMatchObject({ ok: false });
    expect(validateUsageFilters({ from: "2026-04-04T08:45", to: "2026-04-03T08:45", providerId: "", modelId: "", agentId: "", status: "" })).toMatchObject({ ok: false });
    expect(validateUsageFilters({ from: "2025-01-01T00:00", to: "2026-04-04T08:45", providerId: "", modelId: "", agentId: "", status: "" })).toMatchObject({ ok: false });
  });

  it("keeps known-zero, read/write, and unknown cache counters distinct", () => {
    expect(formatUsageMetric({ value: null, availability: "unavailable" })).toBe("Unavailable");
    expect(formatUsageMetric({ value: 0, availability: "known" })).toBe("0");
    expect(usageAvailabilityLabel({ value: 0, availability: "known" })).toBe("Known");
    expect(formatUsageMetric({ value: 12, availability: "known" })).toBe("12");
    expect(usageAvailabilityLabel({ value: 12, availability: "known" })).toBe("Known");
    expect(usageAvailabilityLabel({ value: null, availability: "unavailable" })).toBe("Unavailable");
    expect(formatCostWithAvailability(null, "partial")).toBe("Unavailable (Partial)");
  });

  it("identifies stale syncs without changing UTC filter semantics", () => {
    expect(freshnessState("2026-04-03T08:00:00.000Z", Date.parse("2026-04-03T08:10:00.000Z"))).toBe("fresh");
    expect(freshnessState("2026-04-03T08:00:00.000Z", Date.parse("2026-04-03T08:16:00.000Z"))).toBe("stale");
    expect(freshnessState(null)).toBe("unknown");
  });

  it("creates a 30-day draft range", () => {
    const draft = defaultUsageFilterDraft(new Date("2026-04-30T12:00:00.000Z"));
    expect(draft).toMatchObject({ from: "2026-03-31T12:00", to: "2026-04-30T12:00", providerId: "", modelId: "", agentId: "", status: "" });
  });

  it("keeps advisory known-zero, partial subtotal, not-reported, unknown, and freshness states distinct", () => {
    expect(advisoryObservedLabel({ observed: 0, threshold: 1, availability: "known", state: "below" })).toBe("0");
    expect(advisoryObservedLabel({ observed: 2, threshold: 1, availability: "partial", state: "unknown" })).toContain("Partial — reported subtotal");
    expect(advisoryObservedLabel({ observed: null, threshold: 1, availability: "unavailable", state: "unknown" })).toBe("Not reported");
    expect(advisoryObservedLabel({ observed: 2, threshold: 1, availability: "known", state: "unknown" })).toContain("Unknown — insufficient reported data to compare");
    expect(attentionFreshnessLabel("unknown")).toBe("Freshness unknown");
    expect(attentionFreshnessLabel("disabled")).toBe("Freshness disabled");
  });

  it("validates all five advisory fields without treating blank disabled fields as zero", () => {
    const valid = validateUsageThresholdDraft({
      requestCount: "0",
      totalTokens: "12",
      reportedCostAmount: "0.42",
      cacheReadTokens: "",
      cacheWriteTokens: "9",
    }, 3);
    expect(valid).toEqual({
      ok: true,
      replacement: {
        expectedRevision: 3,
        requestCount: 0,
        totalTokens: 12,
        reportedCostAmount: 0.42,
        cacheReadTokens: null,
        cacheWriteTokens: 9,
      },
    });
    expect(validateUsageThresholdDraft({ requestCount: "1.2", totalTokens: "", reportedCostAmount: "", cacheReadTokens: "", cacheWriteTokens: "" }, 3)).toMatchObject({ ok: false });
    expect(validateUsageThresholdDraft({ requestCount: "", totalTokens: "", reportedCostAmount: "Infinity", cacheReadTokens: "", cacheWriteTokens: "" }, 3)).toMatchObject({ ok: false });
  });
});
