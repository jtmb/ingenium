import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, formatUptime } from "../src/lib/time";

const NOW = new Date("2026-07-30T12:00:00.000Z");

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  it("keeps the current short thresholds while using localized unit names", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 59_000).toISOString())).toBe("just now");
    expect(formatRelativeTime(new Date(NOW.getTime() - 60_000).toISOString())).toBe("1 minute ago");
    expect(formatRelativeTime(new Date(NOW.getTime() - 3_600_000).toISOString())).toBe("1 hour ago");
    expect(formatRelativeTime(new Date(NOW.getTime() - 86_400_000).toISOString())).toBe("1 day ago");
    expect(formatRelativeTime(new Date(NOW.getTime() - 604_800_000).toISOString())).toBe("1 week ago");
  });

  it("returns an empty string for missing or invalid dates and clamps future dates", () => {
    expect(formatRelativeTime(undefined)).toBe("");
    expect(formatRelativeTime(null)).toBe("");
    expect(formatRelativeTime("")).toBe("");
    expect(formatRelativeTime("not-a-date")).toBe("");
    expect(formatRelativeTime(new Date(NOW.getTime() + 60_000).toISOString())).toBe("just now");
  });
});

describe("formatUptime", () => {
  it("formats seconds, minutes, and hours without changing the existing layout", () => {
    expect(formatUptime(59)).toBe("59s");
    expect(formatUptime(60)).toBe("1m 0s");
    expect(formatUptime(3661)).toBe("1h 1m");
  });

  it("uses the unavailable marker for non-positive or non-finite values", () => {
    expect(formatUptime(0)).toBe("—");
    expect(formatUptime(-1)).toBe("—");
    expect(formatUptime(Number.NaN)).toBe("—");
    expect(formatUptime(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
